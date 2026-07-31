import type { ViewerRecord } from '@chzzk-bot/contracts';
import type { AttendanceResult, ViewerStore } from '@chzzk-bot/bot-engine';
import { kstDate } from '@chzzk-bot/bot-engine';
import type { ViewerRepository } from '@chzzk-bot/database';
import { noopLogger, type Logger } from '@chzzk-bot/logger';

/**
 * Postgres 를 뒤에 둔 `ViewerStore`.
 *
 * 채널이 열릴 때 시청자 전체를 메모리로 올리고, 채팅은 메모리에서만 계산합니다.
 * 채팅 1건마다 UPDATE 를 날리면 방송 100개가 붙는 순간 DB 가 먼저 무너집니다.
 * 대신 바뀐 사람만 모아 두었다가 주기적으로(그리고 종료 직전에 반드시) 내려씁니다.
 *
 * 트레이드오프는 명확합니다 — 프로세스가 갑자기 죽으면 마지막 저장 이후의
 * 포인트를 잃습니다. 그래서 저장 주기를 짧게(기본 15초) 잡고, 정상 종료 경로
 * 에서는 항상 flush 합니다. 포인트 몇 십 점보다 DB 가 사는 게 중요합니다.
 */
export class PrismaViewerStore implements ViewerStore {
  private readonly viewers = new Map<string, ViewerRecord>();
  private readonly dirty = new Set<string>();
  private readonly log: Logger;
  private flushing: Promise<void> = Promise.resolve();

  private constructor(
    private readonly repository: ViewerRepository,
    private readonly tenantId: string,
    initial: ViewerRecord[],
    logger: Logger
  ) {
    for (const viewer of initial) this.viewers.set(viewer.channelId, viewer);
    this.log = logger.child('viewers');
  }

  static async open(
    repository: ViewerRepository,
    tenantId: string,
    logger: Logger = noopLogger
  ): Promise<PrismaViewerStore> {
    // 상위 2000명만 올립니다. 그 아래는 포인트가 0에 가까워 명령 응답에 영향이
    // 없고, 채팅을 치는 순간 아래 `ensure` 가 새로 만들어 줍니다.
    const initial = await repository.all(tenantId, 2000);
    return new PrismaViewerStore(repository, tenantId, initial, logger);
  }

  get(channelId: string): ViewerRecord | undefined {
    return this.viewers.get(channelId);
  }

  isFirstEver(channelId: string): boolean {
    return !this.viewers.has(channelId);
  }

  private ensure(channelId: string, nickname: string): ViewerRecord {
    const existing = this.viewers.get(channelId);
    if (existing) return existing;

    const now = Date.now();
    const created: ViewerRecord = {
      channelId,
      nickname,
      points: 0,
      chatCount: 0,
      firstSeenAt: now,
      lastSeenAt: now,
      attendanceStreak: 0,
      lastAttendanceDate: '',
    };
    this.viewers.set(channelId, created);
    this.dirty.add(channelId);
    return created;
  }

  recordChat(channelId: string, nickname: string, pointsEarned: number): number {
    const viewer = this.ensure(channelId, nickname);
    viewer.nickname = nickname || viewer.nickname;
    viewer.chatCount += 1;
    viewer.lastSeenAt = Date.now();
    viewer.points += pointsEarned;
    this.dirty.add(channelId);
    return viewer.points;
  }

  addPoints(channelId: string, nickname: string, delta: number): number {
    const viewer = this.ensure(channelId, nickname);
    viewer.points = Math.max(0, viewer.points + delta);
    if (nickname) viewer.nickname = nickname;
    this.dirty.add(channelId);
    return viewer.points;
  }

  spendPoints(channelId: string, cost: number): boolean {
    const viewer = this.viewers.get(channelId);
    if (!viewer || viewer.points < cost) return false;

    viewer.points = Math.max(0, viewer.points - cost);
    this.dirty.add(channelId);
    return true;
  }

  checkAttendance(
    channelId: string,
    nickname: string,
    rewardBase: number,
    streakBonus: number,
    maxStreakBonus: number
  ): AttendanceResult {
    const viewer = this.ensure(channelId, nickname);
    const today = kstDate();

    if (viewer.lastAttendanceDate === today) {
      return { checked: false, streak: viewer.attendanceStreak, reward: 0 };
    }

    const yesterday = kstDate(Date.now() - 86_400_000);
    const streak = viewer.lastAttendanceDate === yesterday ? viewer.attendanceStreak + 1 : 1;
    const reward = rewardBase + Math.min((streak - 1) * streakBonus, maxStreakBonus);

    viewer.attendanceStreak = streak;
    viewer.lastAttendanceDate = today;
    viewer.points += reward;
    if (nickname) viewer.nickname = nickname;
    this.dirty.add(channelId);

    return { checked: true, streak, reward };
  }

  topByPoints(limit = 10): ViewerRecord[] {
    return [...this.viewers.values()]
      .filter((v) => v.points > 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, limit);
  }

  topByChat(limit = 10): ViewerRecord[] {
    return [...this.viewers.values()].sort((a, b) => b.chatCount - a.chatCount).slice(0, limit);
  }

  rankOf(channelId: string): number | null {
    const viewer = this.viewers.get(channelId);
    if (!viewer) return null;
    let higher = 0;
    for (const other of this.viewers.values()) if (other.points > viewer.points) higher += 1;
    return higher + 1;
  }

  get userCount(): number {
    return this.viewers.size;
  }

  all(): ViewerRecord[] {
    return [...this.viewers.values()];
  }

  resetAllPoints(): void {
    for (const viewer of this.viewers.values()) {
      viewer.points = 0;
      this.dirty.add(viewer.channelId);
    }
  }

  /**
   * 바뀐 사람만 내려씁니다.
   *
   * 쓰기를 직렬화하는 이유는, 주기 저장과 종료 저장이 겹칠 때 두 번째가 첫
   * 번째보다 먼저 끝나 옛 값이 나중에 덮어쓰는 걸 막기 위해서입니다.
   */
  flush(): Promise<void> {
    if (this.dirty.size === 0) return this.flushing;

    const batch = [...this.dirty]
      .map((id) => this.viewers.get(id))
      .filter((v): v is ViewerRecord => v !== undefined);
    this.dirty.clear();

    this.flushing = this.flushing.then(async () => {
      try {
        await this.repository.flushMany(this.tenantId, batch);
        this.log.debug(`시청자 ${batch.length}명 저장`);
      } catch (error) {
        // 저장이 실패했으니 "저장할 게 남았다" 는 사실을 되돌려 놓습니다.
        // 그러지 않으면 다음 flush 가 이 변경분을 영영 건너뜁니다.
        for (const viewer of batch) this.dirty.add(viewer.channelId);
        this.log.error(`시청자 ${batch.length}명 저장에 실패했습니다.`, error);
      }
    });

    return this.flushing;
  }
}
