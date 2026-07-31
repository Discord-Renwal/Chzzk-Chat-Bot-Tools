import type { LogEntry, LogKind } from '@chzzk-bot/contracts';
import type { EventSink } from '@chzzk-bot/bot-engine';
import type { BotRuntimeRepository } from '@chzzk-bot/database';
import { noopLogger, type Logger } from '@chzzk-bot/logger';

/**
 * 이벤트 로그를 메모리 링 버퍼에 담고 주기적으로 DB 로 흘려보냅니다.
 *
 * 이벤트는 채팅만큼은 아니어도 자주 생기고(명령 실행마다 한 줄), 하나하나가
 * 사용자에게 중요한 값은 아닙니다. 그래서 즉시 쓰기보다 묶어 쓰기가 맞습니다.
 * 대신 화면은 항상 메모리 버퍼를 읽으므로, 아직 저장 전이어도 실시간으로 보입니다.
 */
export class PrismaEventSink implements EventSink {
  private readonly buffer: LogEntry[] = [];
  private readonly unsaved: LogEntry[] = [];
  private readonly log: Logger;
  private nextId = 1;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: BotRuntimeRepository,
    private readonly tenantId: string,
    private readonly capacity = 300,
    logger: Logger = noopLogger
  ) {
    this.log = logger.child('events');
  }

  push(kind: LogKind, message: string, extra: { actor?: string; detail?: string } = {}): LogEntry {
    const entry: LogEntry = {
      id: this.nextId++,
      at: Date.now(),
      kind,
      message,
      ...(extra.actor !== undefined ? { actor: extra.actor } : {}),
      ...(extra.detail !== undefined ? { detail: extra.detail } : {}),
    };

    this.buffer.push(entry);
    if (this.buffer.length > this.capacity) {
      this.buffer.splice(0, this.buffer.length - this.capacity);
    }

    this.unsaved.push(entry);
    // 한 방송에서 이벤트가 몰릴 때 INSERT 를 무한정 미루지 않도록 상한을 둡니다.
    if (this.unsaved.length >= 50) void this.flush();

    return entry;
  }

  recent(limit = 100, sinceId = 0): LogEntry[] {
    const filtered = sinceId > 0 ? this.buffer.filter((e) => e.id > sinceId) : this.buffer;
    return filtered.slice(-limit).reverse();
  }

  get lastId(): number {
    return this.nextId - 1;
  }

  flush(): Promise<void> {
    if (this.unsaved.length === 0) return this.writing;

    const batch = this.unsaved.splice(0, this.unsaved.length);

    this.writing = this.writing.then(async () => {
      try {
        await this.repository.appendEvents(
          this.tenantId,
          batch.map((entry) => ({
            kind: entry.kind,
            message: entry.message,
            at: entry.at,
            ...(entry.actor !== undefined ? { actor: entry.actor } : {}),
            ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
          }))
        );
      } catch (error) {
        // 이벤트 로그는 잃어도 서비스가 멈추지 않습니다. 다시 큐에 넣어 재시도하되,
        // 무한히 쌓이지 않도록 버퍼 크기 이상은 버립니다.
        if (this.unsaved.length < this.capacity) this.unsaved.unshift(...batch);
        this.log.warn(`이벤트 ${batch.length}건 저장에 실패했습니다.`, error);
      }
    });

    return this.writing;
  }
}
