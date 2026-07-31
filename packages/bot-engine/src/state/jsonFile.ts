import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { noopLogger, type Logger } from '@chzzk-bot/logger';

export interface JsonFileOptions<T> {
  filePath: string;
  /** 파일이 없을 때 쓸 초기값 */
  fallback: () => T;
  /** 읽어들인 값을 검증합니다. 실패하면 throw 하세요. */
  parse: (raw: unknown) => T;
  logger?: Logger;
  /**
   * 쓰기를 미루는 시간(ms). 포인트처럼 채팅마다 갱신되는 데이터는
   * 매번 디스크에 쓰면 낭비라 묶어서 저장합니다. 0 이면 즉시 저장.
   */
  flushDelayMs?: number;
}

/**
 * JSON 파일 하나를 안전하게 읽고 쓰는 최소한의 저장소.
 *
 * 설정(ConfigStore)과 사용자 데이터(포인트 등)가 같은 요구사항을 갖고 있어 공통화했습니다.
 * - 쓰기는 임시 파일 + rename 으로 원자적으로 처리해, 저장 도중 죽어도 반쯤 쓰인 파일이 남지 않습니다.
 * - 쓰기를 직렬화해 동시 갱신이 뒤엉키지 않습니다.
 * - flushDelayMs 를 주면 짧은 시간의 연속 변경을 한 번의 쓰기로 묶습니다.
 */
export class JsonFile<T> {
  private readonly filePath: string;
  private readonly log: Logger;
  private readonly flushDelayMs: number;

  private data: T;
  private writeQueue: Promise<void> = Promise.resolve();
  private pendingTimer: NodeJS.Timeout | undefined;
  private dirty = false;
  private lastWriteError: unknown;

  private constructor(filePath: string, data: T, options: JsonFileOptions<T>) {
    this.filePath = filePath;
    this.data = data;
    this.flushDelayMs = options.flushDelayMs ?? 0;
    this.log = (options.logger ?? noopLogger).child('store');
  }

  static async open<T>(options: JsonFileOptions<T>): Promise<JsonFile<T>> {
    const path = resolve(options.filePath);
    const log = options.logger ?? noopLogger;

    let data: T;
    try {
      const raw = await readFile(path, 'utf8');
      data = options.parse(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // 파일이 깨졌을 때 조용히 기본값으로 덮으면 사용자가 데이터를 잃습니다.
        throw new Error(
          `${path} 를 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      data = options.fallback();
      log.info(`${path} 가 없어 새로 만듭니다.`);
      const store = new JsonFile(path, data, options);
      await store.flush();
      return store;
    }

    return new JsonFile(path, data, options);
  }

  get path(): string {
    return this.filePath;
  }

  /** 읽기 전용 접근. 반환값을 직접 고치지 말고 update() 를 쓰세요. */
  get current(): Readonly<T> {
    return this.data;
  }

  /** 값을 바꾸고 저장을 예약합니다. */
  update(mutate: (draft: T) => void): void {
    mutate(this.data);
    this.dirty = true;

    if (this.flushDelayMs === 0) {
      void this.flush();
      return;
    }
    if (this.pendingTimer) return;

    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = undefined;
      void this.flush();
    }, this.flushDelayMs);
    this.pendingTimer.unref?.();
  }

  /** 예약된 쓰기를 즉시 실행합니다. 종료 직전에 호출하세요. */
  flush(): Promise<void> {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = undefined;
    }

    const snapshot = JSON.stringify(this.data, null, 2);
    this.dirty = false;

    this.writeQueue = this.writeQueue.then(async () => {
      try {
        await mkdir(dirname(this.filePath), { recursive: true });
        const tmp = `${this.filePath}.tmp`;
        await writeFile(tmp, snapshot, 'utf8');
        await rename(tmp, this.filePath);
        this.lastWriteError = undefined;
      } catch (error) {
        // 여기서 던지면 두 가지가 한꺼번에 나빠집니다.
        // ① update() 가 띄운 쓰기는 아무도 await 하지 않아 unhandled rejection 이 되고,
        // ② 실패한 프라미스가 큐에 남아 이후 쓰기까지 전부 함께 실패합니다.
        // 그래서 삼키되, 조용히 잃지 않도록 기록하고 로그를 남깁니다.
        this.lastWriteError = error;
        // 저장이 안 됐으므로 "저장할 게 남았다" 는 사실을 되돌려 놓습니다.
        // 그러지 않으면 hasPendingWrites 가 false 라고 거짓말해서,
        // 이를 "안전하게 종료해도 된다" 는 신호로 쓰는 쪽이 데이터를 잃습니다.
        this.dirty = true;
        this.log.error(`${this.filePath} 저장에 실패했습니다.`, error);
      }
    });
    return this.writeQueue;
  }

  /** 마지막 쓰기가 실패했다면 그 오류. 성공했으면 undefined */
  get writeError(): unknown {
    return this.lastWriteError;
  }

  /** 저장할 게 남아 있는지 */
  get hasPendingWrites(): boolean {
    return this.dirty || this.pendingTimer !== undefined;
  }
}
