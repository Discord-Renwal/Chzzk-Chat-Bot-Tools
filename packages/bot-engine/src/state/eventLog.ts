import type { LogEntry, LogKind } from '@chzzk-bot/contracts';
import type { EventSink } from '../ports.js';

/**
 * 최근 이벤트를 메모리에 담는 `EventSink` 구현.
 *
 * 채팅 로그는 개인정보에 가깝고 금방 커지므로, 여기서는 "지금 봇이 뭘 하고 있나"
 * 를 보여줄 만큼만 링 버퍼로 들고 있습니다. 서비스에서는 이 뒤에 Postgres 로
 * 흘려보내는 구현(`apps/core/src/adapters`)이 붙어, 플랜별 보관 기간만큼 남습니다.
 */
export class EventLog implements EventSink {
  private readonly entries: LogEntry[] = [];
  private nextId = 1;

  constructor(private readonly capacity = 300) {}

  push(kind: LogKind, message: string, extra: { actor?: string; detail?: string } = {}): LogEntry {
    const entry: LogEntry = {
      id: this.nextId++,
      at: Date.now(),
      kind,
      message,
      ...(extra.actor !== undefined ? { actor: extra.actor } : {}),
      ...(extra.detail !== undefined ? { detail: extra.detail } : {}),
    };

    this.entries.push(entry);
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
    }
    return entry;
  }

  /**
   * 최근 항목을 새 것부터 돌려줍니다.
   * @param sinceId 이 id 보다 큰 것만 (대시보드가 폴링할 때 씁니다)
   */
  recent(limit = 100, sinceId = 0): LogEntry[] {
    const filtered = sinceId > 0 ? this.entries.filter((e) => e.id > sinceId) : this.entries;
    return filtered.slice(-limit).reverse();
  }

  get lastId(): number {
    return this.nextId - 1;
  }

  clear(): void {
    this.entries.length = 0;
  }
}
