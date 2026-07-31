import type { TimerMessage } from '@chzzk-bot/contracts';
import { noopLogger, type Logger } from '@chzzk-bot/logger';

/**
 * 주기 메시지 스케줄러.
 *
 * 단순히 setInterval 을 걸지 않는 이유는 두 가지입니다.
 * 1. 채팅이 없는 빈 방송에 봇 혼자 떠드는 걸 막아야 합니다 → 최소 채팅 수 조건.
 * 2. 여러 타이머가 같은 순간에 겹쳐 도배되면 안 됩니다 → 전역 최소 간격.
 *
 * 그래서 10초마다 한 번씩 "지금 보낼 게 있나" 를 확인하는 방식으로 구현했습니다.
 */
export class TimerScheduler {
  private ticker: NodeJS.Timeout | undefined;
  private readonly lastFiredAt = new Map<string, number>();
  /** 마지막으로 보낸 시각 — 타이머끼리 겹치지 않게 하는 전역 간격에 씁니다. */
  private lastAnyFiredAt = 0;
  /** 각 타이머가 마지막으로 발사된 이후 흘러간 채팅 수 */
  private chatSinceFire = new Map<string, number>();
  private readonly log: Logger;

  constructor(
    private readonly getTimers: () => TimerMessage[],
    private readonly send: (message: string) => Promise<void>,
    options: { logger?: Logger; tickMs?: number; minGapMs?: number } = {}
  ) {
    this.log = (options.logger ?? noopLogger).child('timer');
    this.tickMs = options.tickMs ?? 10_000;
    this.minGapMs = options.minGapMs ?? 30_000;
  }

  private readonly tickMs: number;
  private readonly minGapMs: number;

  start(): void {
    if (this.ticker) return;
    // 시작하자마자 쏟아지지 않도록 기준 시각을 지금으로 잡습니다.
    this.sync();

    this.ticker = setInterval(() => void this.tick(), this.tickMs);
    this.ticker.unref?.();
    this.log.debug('주기 메시지 스케줄러를 시작했습니다.');
  }

  /**
   * 타이머 하나의 상태를 준비합니다.
   *
   * 이걸 한 곳에 모은 이유: 예전에는 start() 가 `lastFiredAt` 만 채우고
   * `chatSinceFire` 를 비워 뒀는데, noteChat() 은 이미 있는 항목만 세도록
   * 되어 있어서 **시작 시점에 있던 타이머는 채팅 수가 영원히 0** 이었습니다.
   * 기본값이 10줄이라 주기 메시지가 아예 발사되지 않았습니다.
   */
  private register(id: string, now: number): void {
    if (!this.lastFiredAt.has(id)) this.lastFiredAt.set(id, now);
    if (!this.chatSinceFire.has(id)) this.chatSinceFire.set(id, 0);
  }

  stop(): void {
    if (!this.ticker) return;
    clearInterval(this.ticker);
    this.ticker = undefined;
  }

  /**
   * 채팅이 올 때마다 호출해 주세요. 최소 채팅 수 조건에 씁니다.
   *
   * 맵에 이미 있는 항목만 세지 않고 **현재 타이머 목록을 기준으로** 셉니다.
   * 등록 순서에 따라 조용히 세지 않는 일이 없도록 하기 위해서입니다.
   */
  noteChat(): void {
    const now = Date.now();
    for (const timer of this.getTimers()) {
      this.register(timer.id, now);
      this.chatSinceFire.set(timer.id, (this.chatSinceFire.get(timer.id) ?? 0) + 1);
    }
  }

  /** 다음 발사까지 남은 초 (대시보드 표시용). 조건 미달이면 null */
  nextInSeconds(timer: TimerMessage): number | null {
    const last = this.lastFiredAt.get(timer.id);
    if (last === undefined) return null;
    const due = last + timer.intervalMinutes * 60_000;
    return Math.max(0, Math.ceil((due - Date.now()) / 1000));
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    if (now - this.lastAnyFiredAt < this.minGapMs) return;

    for (const timer of this.getTimers()) {
      if (!timer.enabled) continue;

      // 아직 모르는 타이머면 이번 tick 을 기준으로 시작합니다.
      // 이미 세어 둔 채팅 수는 지우지 않습니다 — 지우면 대시보드에서 방금 만든
      // 타이머가 다음 tick 에 카운트를 잃습니다.
      if (!this.lastFiredAt.has(timer.id)) {
        this.register(timer.id, now);
        continue;
      }

      const last = this.lastFiredAt.get(timer.id)!;
      if (now - last < timer.intervalMinutes * 60_000) continue;

      const chats = this.chatSinceFire.get(timer.id) ?? 0;
      if (chats < timer.minChatsSinceLast) {
        // 조건 미달이면 타이머를 소모하지 않고 다음 기회를 기다립니다.
        continue;
      }

      this.lastFiredAt.set(timer.id, now);
      this.chatSinceFire.set(timer.id, 0);
      this.lastAnyFiredAt = now;

      try {
        await this.send(timer.message);
        this.log.info(`주기 메시지를 보냈습니다: ${timer.label || timer.message.slice(0, 20)}`);
      } catch (error) {
        this.log.error('주기 메시지 전송에 실패했습니다.', error);
      }
      // 한 tick 에 하나만 보냅니다. 여러 개가 동시에 만기여도 도배하지 않습니다.
      return;
    }
  }

  /** 타이머가 추가/삭제됐을 때 내부 상태를 맞춥니다. */
  sync(): void {
    const now = Date.now();
    const ids = new Set(this.getTimers().map((t) => t.id));

    for (const id of [...this.lastFiredAt.keys()]) {
      if (!ids.has(id)) {
        this.lastFiredAt.delete(id);
        this.chatSinceFire.delete(id);
      }
    }
    for (const id of ids) this.register(id, now);
  }
}
