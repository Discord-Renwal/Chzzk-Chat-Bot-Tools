import type { ChatApi } from '@chzzk-bot/chzzk-sdk';
import { splitMessage } from '@chzzk-bot/chzzk-sdk';
import { noopLogger, type Logger } from '@chzzk-bot/logger';

export interface ChatSenderOptions {
  /**
   * 메시지 사이 최소 간격(ms).
   *
   * 함수를 넘기면 매 전송 직전에 다시 읽습니다. 대시보드에서 값을 바꿨을 때
   * 봇을 재시작하지 않고 반영하려면 함수 형태로 넘기세요.
   */
  intervalMs?: number | (() => number);
  /** 대기열 최대 길이. 넘치면 가장 오래된 것부터 버립니다. 기본 50 */
  maxQueue?: number;
  logger?: Logger;
}

interface QueueItem {
  message: string;
  resolve: () => void;
  reject: (error: unknown) => void;
}

/**
 * 채팅 전송을 직렬화하는 큐.
 *
 * 봇이 이벤트마다 즉시 `chat.send()` 를 호출하면 429 (TOO_MANY_REQUESTS) 를 맞기 쉽습니다.
 * 이 클래스는 전송을 한 줄로 세우고 최소 간격을 지키며, 100자 초과 메시지는 자동으로 나눕니다.
 */
export class ChatSender {
  private readonly queue: QueueItem[] = [];
  private readonly getIntervalMs: () => number;
  private readonly maxQueue: number;
  private readonly log: Logger;
  private draining = false;
  private lastSentAt = 0;

  constructor(
    private readonly chat: ChatApi,
    options: ChatSenderOptions = {}
  ) {
    const interval = options.intervalMs ?? 2000;
    this.getIntervalMs = typeof interval === 'function' ? interval : () => interval;
    this.maxQueue = options.maxQueue ?? 50;
    this.log = (options.logger ?? noopLogger).child('sender');
  }

  get pending(): number {
    return this.queue.length;
  }

  /** 메시지를 큐에 넣습니다. 실제 전송이 끝나면 resolve 됩니다. */
  async send(message: string): Promise<void> {
    const chunks = splitMessage(message);

    await Promise.all(
      chunks.map(
        (chunk) =>
          new Promise<void>((resolve, reject) => {
            if (this.queue.length >= this.maxQueue) {
              const dropped = this.queue.shift();
              this.log.warn('전송 대기열이 가득 차 가장 오래된 메시지를 버렸습니다.');
              dropped?.reject(new Error('대기열이 가득 차 메시지가 버려졌습니다.'));
            }
            this.queue.push({ message: chunk, resolve, reject });
            void this.drain();
          })
      )
    );
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    try {
      while (this.queue.length > 0) {
        // 매번 다시 읽어, 설정 변경이 다음 메시지부터 바로 적용되게 합니다.
        const wait = this.getIntervalMs() - (Date.now() - this.lastSentAt);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));

        const item = this.queue.shift();
        if (!item) break;

        try {
          await this.chat.send(item.message);
          this.lastSentAt = Date.now();
          item.resolve();
        } catch (error) {
          this.lastSentAt = Date.now();
          this.log.error(`메시지 전송 실패: ${item.message}`, error);
          item.reject(error);
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
