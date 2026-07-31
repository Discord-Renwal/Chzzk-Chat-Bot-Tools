import { z } from 'zod';
import { JsonFile } from './jsonFile.js';
import type { Logger } from '@chzzk-bot/logger';
import type { AttendanceResult, ViewerStore } from '../ports.js';

/**
 * 시청자별 누적 데이터 — 포인트, 채팅 수, 출석.
 *
 * 설정(config.json)과 분리한 이유는 성격이 다르기 때문입니다. 설정은 사람이 가끔 바꾸는
 * 작은 파일이고, 이쪽은 채팅마다 갱신되며 시청자 수만큼 커집니다. 같은 파일에 두면
 * 대시보드에서 설정을 저장하는 순간 포인트 갱신과 충돌할 수 있습니다.
 */
export const userRecord = z.object({
  channelId: z.string(),
  /** 마지막으로 관측된 닉네임 (바뀔 수 있어 표시용으로만 씁니다) */
  nickname: z.string().default(''),
  points: z.number().int().min(0).default(0),
  chatCount: z.number().int().min(0).default(0),
  /** epoch ms */
  firstSeenAt: z.number().default(0),
  lastSeenAt: z.number().default(0),
  /** 연속 출석 일수 */
  attendanceStreak: z.number().int().min(0).default(0),
  /** 마지막 출석 날짜 (KST 기준 YYYY-MM-DD) */
  lastAttendanceDate: z.string().default(''),
});
export type UserRecord = z.infer<typeof userRecord>;

const userData = z.object({
  version: z.literal(1).default(1),
  users: z.record(z.string(), userRecord).default({}),
});
export type UserData = z.infer<typeof userData>;

/** 한국 시간 기준 날짜 문자열. 출석 판정에 씁니다. */
export function kstDate(at: number = Date.now()): string {
  // KST 는 UTC+9 고정이라 오프셋을 더해 UTC 기준으로 읽으면 됩니다.
  return new Date(at + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export class JsonViewerStore implements ViewerStore {
  private constructor(private readonly file: JsonFile<UserData>) {}

  static async open(filePath = 'data/users.json', logger?: Logger): Promise<JsonViewerStore> {
    const file = await JsonFile.open<UserData>({
      filePath,
      fallback: () => userData.parse({}),
      parse: (raw) => userData.parse(raw),
      // 채팅마다 저장하면 디스크가 놀아나므로 5초씩 묶습니다.
      flushDelayMs: 5000,
      ...(logger ? { logger } : {}),
    });
    return new JsonViewerStore(file);
  }

  get path(): string {
    return this.file.path;
  }

  get(channelId: string): UserRecord | undefined {
    return this.file.current.users[channelId];
  }

  /** 없으면 만들어서 돌려줍니다. */
  private ensure(channelId: string, nickname: string): UserRecord {
    const existing = this.file.current.users[channelId];
    if (existing) return existing;

    const now = Date.now();
    const created = userRecord.parse({ channelId, nickname, firstSeenAt: now, lastSeenAt: now });
    this.file.update((draft) => {
      draft.users[channelId] = created;
    });
    return created;
  }

  /** 이 사람이 이번이 처음 보는 채팅인지 (첫 인사에 씁니다) */
  isFirstEver(channelId: string): boolean {
    return this.file.current.users[channelId] === undefined;
  }

  /**
   * 채팅 1회를 기록하고 포인트를 적립합니다.
   * @returns 적립 후 총 포인트
   */
  recordChat(channelId: string, nickname: string, pointsEarned: number): number {
    this.ensure(channelId, nickname);

    let total = 0;
    this.file.update((draft) => {
      const user = draft.users[channelId];
      if (!user) return;
      user.nickname = nickname || user.nickname;
      user.chatCount += 1;
      user.lastSeenAt = Date.now();
      user.points += pointsEarned;
      total = user.points;
    });
    return total;
  }

  /** 포인트를 더하거나 뺍니다. 0 아래로는 내려가지 않습니다. */
  addPoints(channelId: string, nickname: string, delta: number): number {
    this.ensure(channelId, nickname);

    let total = 0;
    this.file.update((draft) => {
      const user = draft.users[channelId];
      if (!user) return;
      user.points = Math.max(0, user.points + delta);
      if (nickname) user.nickname = nickname;
      total = user.points;
    });
    return total;
  }

  /** 포인트가 충분하면 차감하고 true. 부족하면 아무것도 하지 않고 false. */
  spendPoints(channelId: string, cost: number): boolean {
    const user = this.file.current.users[channelId];
    if (!user || user.points < cost) return false;

    this.file.update((draft) => {
      const target = draft.users[channelId];
      if (target) target.points = Math.max(0, target.points - cost);
    });
    return true;
  }

  /** 출석 체크. 하루 한 번만 인정하고 연속일수를 셉니다. */
  checkAttendance(
    channelId: string,
    nickname: string,
    rewardBase: number,
    streakBonus: number,
    maxStreakBonus: number
  ): AttendanceResult {
    this.ensure(channelId, nickname);

    const today = kstDate();
    const user = this.file.current.users[channelId];
    if (user?.lastAttendanceDate === today) {
      return { checked: false, streak: user.attendanceStreak, reward: 0 };
    }

    const yesterday = kstDate(Date.now() - 24 * 60 * 60 * 1000);
    let streak = 1;
    let reward = rewardBase;

    this.file.update((draft) => {
      const target = draft.users[channelId];
      if (!target) return;

      // 어제 출석했으면 연속, 아니면 처음부터.
      streak = target.lastAttendanceDate === yesterday ? target.attendanceStreak + 1 : 1;
      reward = rewardBase + Math.min((streak - 1) * streakBonus, maxStreakBonus);

      target.attendanceStreak = streak;
      target.lastAttendanceDate = today;
      target.points += reward;
      if (nickname) target.nickname = nickname;
    });

    return { checked: true, streak, reward };
  }

  /** 포인트 상위 목록 */
  topByPoints(limit = 10): UserRecord[] {
    return Object.values(this.file.current.users)
      .filter((u) => u.points > 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, limit);
  }

  /** 채팅 수 상위 목록 */
  topByChat(limit = 10): UserRecord[] {
    return Object.values(this.file.current.users)
      .sort((a, b) => b.chatCount - a.chatCount)
      .slice(0, limit);
  }

  /** 포인트 순위 (1부터). 없으면 null */
  rankOf(channelId: string): number | null {
    const user = this.file.current.users[channelId];
    if (!user) return null;
    const higher = Object.values(this.file.current.users).filter(
      (u) => u.points > user.points
    ).length;
    return higher + 1;
  }

  get userCount(): number {
    return Object.keys(this.file.current.users).length;
  }

  /** 전체 사용자 (대시보드 목록용) */
  all(): UserRecord[] {
    return Object.values(this.file.current.users);
  }

  /** 모든 포인트를 0으로. 대시보드에서 시즌을 초기화할 때 씁니다. */
  resetAllPoints(): void {
    this.file.update((draft) => {
      for (const user of Object.values(draft.users)) user.points = 0;
    });
  }

  flush(): Promise<void> {
    return this.file.flush();
  }
}
