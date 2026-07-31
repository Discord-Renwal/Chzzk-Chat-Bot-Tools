import { EventEmitter } from 'node:events';
import io from 'socket.io-client';
import type { SessionsApi } from '../api/sessions.js';
import type { SessionEventType } from '../api/types.js';
import { noopLogger, type Logger } from '@chzzk-bot/logger';
import { MAX_SUBSCRIPTIONS_PER_SESSION } from '../api/sessions.js';
import { ChzzkValidationError } from '../core/errors.js';
import type {
  ChatEvent,
  DonationEvent,
  SessionClientEvents,
  SubscriptionEvent,
  SystemEvent,
} from './events.js';

export interface SessionClientOptions {
  /** 구독할 이벤트. 기본은 채팅만. */
  events?: SessionEventType[];
  /** 세션 생성 시 사용할 인증 방식 */
  authMode?: 'user' | 'client';
  logger?: Logger;
  /** 연결이 끊겼을 때 자동으로 다시 붙일지. 기본 true */
  autoReconnect?: boolean;
  /** 재연결 시도 상한. 기본 무제한(Infinity) */
  maxReconnectAttempts?: number;
}

type Handler<K extends keyof SessionClientEvents> = (...args: SessionClientEvents[K]) => void;

/**
 * CHZZK 세션(소켓) 클라이언트.
 *
 * ## 왜 socket.io-client 2.x 인가
 * 공식 문서는 "socket.io-client 1.0.0+ 2.0.3 버전까지 지원"이라고 명시합니다.
 * v3/v4 는 프로토콜이 달라 **핸드셰이크 자체가 실패**하므로 package.json 에서 `2.5.0` 으로
 * 정확히 고정해 두었습니다. 업그레이드하지 마세요.
 *
 * ## 재연결
 * 발급된 소켓 URL은 일정 시간만 유효해서, socket.io 내장 재연결(`reconnection: true`)로는
 * 만료된 URL에 계속 재시도하게 됩니다. 그래서 내장 재연결은 끄고, 끊길 때마다
 * 세션 URL을 **새로 발급받아** 처음부터 다시 연결합니다.
 */
export class ChzzkSessionClient {
  private readonly emitter = new EventEmitter();
  private readonly log: Logger;
  private readonly events: SessionEventType[];
  private readonly authMode: 'user' | 'client';
  private readonly autoReconnect: boolean;
  private readonly maxReconnectAttempts: number;

  private socket: SocketIOClient.Socket | undefined;
  private sessionKey: string | undefined;
  private attempts = 0;
  private closed = false;
  private reconnectTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly sessions: SessionsApi,
    options: SessionClientOptions = {}
  ) {
    this.events = options.events ?? ['CHAT'];
    this.authMode = options.authMode ?? 'user';
    this.autoReconnect = options.autoReconnect ?? true;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? Infinity;
    this.log = (options.logger ?? noopLogger).child('session');

    if (this.events.length === 0) {
      throw new ChzzkValidationError('구독할 이벤트를 최소 하나는 지정해야 합니다.');
    }
    if (this.events.length > MAX_SUBSCRIPTIONS_PER_SESSION) {
      throw new ChzzkValidationError(
        `세션당 구독은 최대 ${MAX_SUBSCRIPTIONS_PER_SESSION}개입니다.`
      );
    }
  }

  on<K extends keyof SessionClientEvents>(event: K, handler: Handler<K>): this {
    this.emitter.on(event, handler as (...args: unknown[]) => void);
    return this;
  }

  off<K extends keyof SessionClientEvents>(event: K, handler: Handler<K>): this {
    this.emitter.off(event, handler as (...args: unknown[]) => void);
    return this;
  }

  once<K extends keyof SessionClientEvents>(event: K, handler: Handler<K>): this {
    this.emitter.once(event, handler as (...args: unknown[]) => void);
    return this;
  }

  private emit<K extends keyof SessionClientEvents>(
    event: K,
    ...args: SessionClientEvents[K]
  ): void {
    // 'error' 리스너가 없으면 EventEmitter 가 프로세스를 죽이므로 직접 흡수합니다.
    if (event === 'error' && this.emitter.listenerCount('error') === 0) {
      this.log.error('처리되지 않은 세션 오류', args[0]);
      return;
    }
    this.emitter.emit(event, ...args);
  }

  /** 현재 세션 식별자 (연결 전이면 undefined) */
  get currentSessionKey(): string | undefined {
    return this.sessionKey;
  }

  /** 세션 URL을 발급받아 소켓에 연결합니다. */
  async connect(): Promise<void> {
    this.closed = false;

    const { url } =
      this.authMode === 'client'
        ? await this.sessions.createClientSession()
        : await this.sessions.createUserSession();

    this.log.debug(`세션 URL 발급 완료 (${new URL(url).host})`);

    // 문서 예제의 v1-era 옵션 키를 그대로 사용합니다 (공백 포함 문자열 키가 맞습니다).
    const socket = io.connect(url, {
      reconnection: false,
      'force new connection': true,
      'connect timeout': 3000,
      transports: ['websocket'],
    } as SocketIOClient.ConnectOpts);

    this.socket = socket;
    this.bind(socket);
  }

  private bind(socket: SocketIOClient.Socket): void {
    socket.on('connect', () => {
      this.log.info('소켓에 연결되었습니다. SYSTEM connected 이벤트를 기다립니다.');
    });

    socket.on('SYSTEM', (raw: unknown) => {
      const event = parsePayload<SystemEvent>(raw);
      if (!event) return;

      this.emit('system', event);

      if (event.type === 'connected') {
        this.attempts = 0;
        this.sessionKey = event.data.sessionKey;
        void this.subscribeAll(event.data.sessionKey);
        return;
      }
      if (event.type === 'revoked') {
        this.log.warn(`권한이 회수되었습니다: ${event.data.eventType} / ${event.data.channelId}`);
        this.emit('revoked', event.data);
      }
    });

    socket.on('CHAT', (raw: unknown) => {
      const event = parsePayload<ChatEvent>(raw);
      if (event) this.emit('chat', event);
    });

    socket.on('DONATION', (raw: unknown) => {
      const event = parsePayload<DonationEvent>(raw);
      if (event) this.emit('donation', event);
    });

    socket.on('SUBSCRIPTION', (raw: unknown) => {
      const event = parsePayload<SubscriptionEvent>(raw);
      if (event) this.emit('subscription', event);
    });

    socket.on('connect_error', (err: unknown) => {
      this.emit('error', asError(err, '소켓 연결에 실패했습니다.'));
      this.scheduleReconnect();
    });

    socket.on('disconnect', (reason: unknown) => {
      const why = typeof reason === 'string' ? reason : 'unknown';
      this.log.warn(`소켓 연결이 끊어졌습니다 (${why}).`);
      this.sessionKey = undefined;
      this.emit('disconnect', { reason: why });
      this.scheduleReconnect();
    });
  }

  /**
   * SYSTEM `connected` 직후 구독을 겁니다.
   *
   * 여기서 실패하면 **소켓은 붙어 있는데 아무 이벤트도 안 오는 상태**가 됩니다.
   * 봇은 멀쩡해 보이는데 채팅을 하나도 못 받는, 가장 알아채기 어려운 고장입니다.
   * 그래서 실패를 그냥 알리고 끝내지 않고 재시도하고, 그래도 안 되면 세션을
   * 처음부터 새로 만듭니다.
   *
   * 특히 연결 직후 404 NOT_FOUND 가 나는 경우가 있는데, 서버가 방금 만든 세션을
   * 아직 구독 API 쪽에 반영하지 못한 것으로 보입니다. 짧게 기다렸다 다시 걸면 붙습니다.
   */
  private async subscribeAll(sessionKey: string): Promise<void> {
    const MAX_TRIES = 4;

    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      try {
        for (const event of this.events) {
          await this.sessions.subscribe(event, sessionKey, this.authMode);
          this.log.info(`${event} 이벤트를 구독했습니다.`);
        }
        this.emit('ready', { sessionKey });
        return;
      } catch (error) {
        // 세션이 이미 바뀌었다면 이 시도는 의미가 없습니다.
        if (this.sessionKey !== sessionKey || this.closed) return;

        if (attempt < MAX_TRIES) {
          const delayMs = 300 * 2 ** (attempt - 1); // 300 · 600 · 1200ms
          this.log.warn(
            `이벤트 구독 실패 — ${delayMs}ms 후 재시도합니다 (${attempt}/${MAX_TRIES}).`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        this.emit('error', asError(error, '이벤트 구독에 실패했습니다.'));
        this.log.error('구독에 계속 실패해 세션을 새로 만듭니다.');
        // 구독 없는 소켓은 쓸모가 없습니다. 끊고 처음부터 다시 붙습니다.
        this.teardownSocket();
        this.scheduleReconnect();
        return;
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || !this.autoReconnect) return;
    if (this.reconnectTimer) return;
    if (this.attempts >= this.maxReconnectAttempts) {
      this.emit(
        'error',
        new Error(`재연결 시도 한도(${this.maxReconnectAttempts}회)를 넘었습니다.`)
      );
      return;
    }

    this.attempts += 1;
    // 1s, 2s, 4s … 최대 30s
    const delayMs = Math.min(1000 * 2 ** (this.attempts - 1), 30_000);
    this.emit('reconnecting', { attempt: this.attempts, delayMs });
    this.log.info(`${delayMs}ms 후 재연결합니다 (${this.attempts}번째 시도).`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.teardownSocket();
      // 만료됐을 수 있는 URL 대신 세션을 새로 발급받습니다.
      this.connect().catch((error: unknown) => {
        this.emit('error', asError(error, '재연결에 실패했습니다.'));
        this.scheduleReconnect();
      });
    }, delayMs);
    this.reconnectTimer.unref?.();
  }

  private teardownSocket(): void {
    if (!this.socket) return;
    this.socket.removeAllListeners();
    this.socket.close();
    this.socket = undefined;
  }

  /** 구독을 해제하고 소켓을 닫습니다. */
  async close(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.sessionKey) {
      for (const event of this.events) {
        try {
          await this.sessions.unsubscribe(event, this.sessionKey, this.authMode);
        } catch (error) {
          this.log.debug(`${event} 구독 해제 실패 (무시하고 진행합니다).`, error);
        }
      }
    }

    this.teardownSocket();
    this.sessionKey = undefined;
    this.log.info('세션을 종료했습니다.');
  }
}

/**
 * 페이로드가 객체로 올 때도, JSON 문자열로 올 때도 있어 양쪽을 모두 받아냅니다.
 */
function parsePayload<T>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object') return raw as T;
  return null;
}

function asError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value;
  return new Error(`${fallback} (${String(value)})`);
}
