import type {
  BotConfig,
  CustomCommand,
  LogEntry,
  LogKind,
  SongRequest,
  ViewerRecord,
} from '@chzzk-bot/contracts';

/**
 * 봇 엔진이 바깥 세계에 요구하는 것들.
 *
 * 엔진은 채팅 한 줄을 어떻게 해석할지만 압니다. 그 값이 JSON 파일에 있는지
 * Postgres 에 있는지는 몰라야 합니다 — 알게 되는 순간 로컬에서 파일로 돌리던
 * 봇을 SaaS 로 올릴 수 없고, 테스트마다 DB 를 띄워야 합니다.
 *
 * 그래서 저장소는 전부 아래 인터페이스로만 들어옵니다. 구현은 두 벌입니다.
 *   - JSON 파일  (`state/` 아래. 로컬 실행과 단위 테스트)
 *   - Postgres   (`apps/core/src/adapters`. 실제 서비스)
 */

// ─── 설정 ─────────────────────────────────────────────────────────────────────

export interface ConfigSource {
  /**
   * 현재 설정. **읽기 전용이며 고치면 안 됩니다.**
   *
   * 채팅 1건마다 두세 번 불리는 경로라 복사본을 만들지 않고 그 순간의 객체를
   * 그대로 돌려줍니다. 대신 얼려 두었으므로 고치려 하면 바로 실패합니다.
   */
  snapshot(): BotConfig;

  /** 이름 또는 별칭으로 찾습니다. */
  findCommand(nameOrAlias: string): CustomCommand | undefined;

  setCommandItems(id: string, items: string[]): Promise<void>;

  /** 사용 횟수를 1 올리고, counter 형이면 값도 함께 올립니다. @returns 올린 뒤 counter 값 */
  bumpCommandUsage(id: string, counterDelta?: number): Promise<number>;

  bumpBannedWordHit(id: string): Promise<void>;

  upsertCommand(input: Partial<CustomCommand> & { name: string }): Promise<CustomCommand>;

  /** 대시보드에서 바뀐 값을 다시 읽어옵니다. */
  refresh(): Promise<BotConfig>;

  /** 설정이 바뀌면 알려줍니다. 주기 메시지 스케줄러가 이를 듣습니다. */
  on(event: 'change', listener: (config: BotConfig) => void): unknown;
}

// ─── 시청자 (포인트 · 출석) ───────────────────────────────────────────────────

export interface AttendanceResult {
  /** 오늘 이미 출석했으면 false */
  checked: boolean;
  streak: number;
  reward: number;
}

export interface ViewerStore {
  get(channelId: string): ViewerRecord | undefined;
  /** 이 사람이 이번이 처음 보는 채팅인지 (첫 인사에 씁니다) */
  isFirstEver(channelId: string): boolean;

  /** 채팅 1회를 기록하고 포인트를 적립합니다. @returns 적립 후 총 포인트 */
  recordChat(channelId: string, nickname: string, pointsEarned: number): number;
  /** 포인트를 더하거나 뺍니다. 0 아래로는 내려가지 않습니다. */
  addPoints(channelId: string, nickname: string, delta: number): number;
  /** 포인트가 충분하면 차감하고 true. 부족하면 아무것도 하지 않고 false. */
  spendPoints(channelId: string, cost: number): boolean;

  checkAttendance(
    channelId: string,
    nickname: string,
    rewardBase: number,
    streakBonus: number,
    maxStreakBonus: number
  ): AttendanceResult;

  topByPoints(limit?: number): ViewerRecord[];
  topByChat(limit?: number): ViewerRecord[];
  /** 포인트 순위 (1부터). 없으면 null */
  rankOf(channelId: string): number | null;

  readonly userCount: number;
  all(): ViewerRecord[];
  resetAllPoints(): void;

  /** 메모리에 쌓인 변경분을 저장소로 내려씁니다. 종료 직전에 반드시 부르세요. */
  flush(): Promise<void>;
}

// ─── 신청곡 ───────────────────────────────────────────────────────────────────

export interface SongStore {
  pending(): SongRequest[];
  playing(): SongRequest | undefined;
  all(): SongRequest[];
  pendingCountBy(channelId: string): number;
  hasPendingTitle(title: string): boolean;

  add(input: {
    title: string;
    requesterChannelId: string;
    requesterNickname: string;
    pointsSpent?: number;
  }): SongRequest;

  next(): SongRequest | null;
  skip(id?: string): SongRequest | null;
  cancelOwn(channelId: string): SongRequest | null;
  remove(id: string): boolean;
  move(id: string, direction: 'up' | 'down'): boolean;
  clearPending(): number;

  flush(): Promise<void>;
}

// ─── 이벤트 로그 ──────────────────────────────────────────────────────────────

export interface EventSink {
  push(kind: LogKind, message: string, extra?: { actor?: string; detail?: string }): LogEntry;
  recent(limit?: number, sinceId?: number): LogEntry[];
  readonly lastId: number;
}
