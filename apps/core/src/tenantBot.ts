import { ChzzkClient, ChzzkApiError, type ChzzkSessionClient } from '@chzzk-bot/chzzk-sdk';
import { BotRuntime } from '@chzzk-bot/bot-engine';
import type {
  BotInstanceState,
  ExecuteCommandRequest,
  ExecuteCommandResponse,
} from '@chzzk-bot/contracts';
import type { Repositories } from '@chzzk-bot/database';
import type { TokenVault } from '@chzzk-bot/auth';
import { noopLogger, type Logger } from '@chzzk-bot/logger';
import { HEARTBEAT_INTERVAL_MS } from '@chzzk-bot/platform-config';
import { PrismaConfigSource } from './adapters/prismaConfigSource.js';
import { PrismaEventSink } from './adapters/prismaEventSink.js';
import { PrismaSongStore } from './adapters/prismaSongStore.js';
import { PrismaViewerStore } from './adapters/prismaViewerStore.js';

export interface TenantBotDeps {
  tenantId: string;
  ownerId: string;
  chzzkChannelId: string;
  channelName: string;
  repositories: Repositories;
  vault: TokenVault;
  clientId: string;
  clientSecret: string;
  workerId: string;
  /** 설정을 DB 에서 다시 읽는 주기(ms) */
  configRefreshMs: number;
  logger?: Logger;
}

/** 시청자·신청곡·이벤트를 DB 로 내려쓰는 주기 */
const PERSIST_INTERVAL_MS = 15_000;

/**
 * 채널 하나에 붙은 봇.
 *
 * 세션·엔진·저장소 어댑터의 수명을 한 덩어리로 묶습니다. 채널이 늘어난다는 건
 * 이 객체가 하나 더 생긴다는 뜻일 뿐, 다른 채널에는 아무 영향이 없어야 합니다 —
 * 한 방송의 토큰 만료가 다른 방송의 봇을 멈추면 안 됩니다.
 *
 * 세션은 연결돼 있어도 `!입장` 전에는 응답하지 않습니다. 그 판단은 엔진
 * (`BotRuntime`)이 하고, 여기서는 상태 변화를 DB 에 반영해 대시보드에 보여줍니다.
 */
export class TenantBot {
  private readonly log: Logger;
  private chzzk: ChzzkClient | undefined;
  private session: ChzzkSessionClient | undefined;
  private runtime: BotRuntime | undefined;
  private config: PrismaConfigSource | undefined;
  private viewers: PrismaViewerStore | undefined;
  private songs: PrismaSongStore | undefined;
  private events: PrismaEventSink | undefined;

  private heartbeatTimer: NodeJS.Timeout | undefined;
  private persistTimer: NodeJS.Timeout | undefined;
  private configTimer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(private readonly deps: TenantBotDeps) {
    this.log = (deps.logger ?? noopLogger).child(`bot:${deps.channelName}`);
  }

  get tenantId(): string {
    return this.deps.tenantId;
  }

  /**
   * 세션을 열고 채팅을 듣기 시작합니다.
   *
   * 실패해도 던지지 않고 DB 에 ERROR 로 남깁니다. 채널 하나가 못 뜬다고 워커
   * 전체가 죽으면, 토큰이 만료된 사용자 한 명 때문에 모든 방송의 봇이 멈춥니다.
   */
  async start(): Promise<boolean> {
    const { repositories, tenantId } = this.deps;

    await repositories.runtime.setStatus(tenantId, {
      status: 'STARTING',
      workerId: this.deps.workerId,
      lastError: null,
    });

    try {
      await this.connect();
      return true;
    } catch (error) {
      const reason = describeError(error);
      this.log.error(`봇을 시작하지 못했습니다 — ${reason}`);
      await repositories.runtime.setStatus(tenantId, { status: 'ERROR', lastError: reason });
      await this.teardown();
      return false;
    }
  }

  private async connect(): Promise<void> {
    const { repositories, tenantId, ownerId, vault, clientId, clientSecret } = this.deps;

    this.chzzk = new ChzzkClient({
      clientId,
      clientSecret,
      tokenProvider: vault.providerFor(ownerId),
      logger: this.log,
    });

    [this.config, this.viewers, this.songs] = await Promise.all([
      PrismaConfigSource.open(repositories.botConfig, tenantId, this.log),
      PrismaViewerStore.open(repositories.viewers, tenantId, this.log),
      PrismaSongStore.open(repositories.runtime, tenantId, this.log),
    ]);
    this.events = new PrismaEventSink(repositories.runtime, tenantId, 300, this.log);

    this.runtime = new BotRuntime({
      chzzk: this.chzzk,
      config: this.config,
      users: this.viewers,
      songs: this.songs,
      log: this.events,
      botChannelId: this.deps.chzzkChannelId,
      onJoinChange: (joined, by) => void this.onJoinChange(joined, by),
    });

    // 대시보드에서 주기 메시지를 추가/삭제하면 스케줄러에 알려줍니다.
    this.config.on('change', () => this.runtime?.syncTimers());

    this.session = this.chzzk.createSessionClient({
      events: ['CHAT', 'DONATION', 'SUBSCRIPTION'],
      authMode: 'user',
    });

    this.session.on('ready', ({ sessionKey }) => {
      this.log.info(`채팅 구독 시작 (sessionKey=${sessionKey})`);
      void repositories.runtime.setStatus(tenantId, { status: 'IDLE', sessionKey });
      this.events?.push('system', '봇 연결됨 — !입장 을 입력하면 시작합니다.');
    });

    this.session.on('chat', (event) => void this.runtime?.handleChat(event));
    this.session.on('donation', (event) => void this.runtime?.handleDonation(event));
    this.session.on('subscription', (event) => void this.runtime?.handleSubscription(event));

    this.session.on('disconnect', ({ reason }) => {
      this.events?.push('system', `연결 끊김 (${reason})`);
    });

    this.session.on('revoked', ({ eventType }) => {
      // 사용자가 치지직에서 연동을 끊은 경우입니다. 재시도로는 절대 풀리지 않으니
      // 재연결을 시도하지 않고, 다시 로그인해야 한다고 남깁니다.
      this.log.error(`${eventType} 권한이 회수되었습니다. 재인증이 필요합니다.`);
      this.events?.push('error', `${eventType} 권한 회수됨 — 다시 로그인해 주세요.`);
      void repositories.runtime.setStatus(tenantId, {
        status: 'ERROR',
        lastError: '치지직 연동이 해제되었습니다. 다시 로그인해 주세요.',
      });
      void this.stop();
    });

    this.session.on('error', (error) => {
      this.events?.push('error', '세션 오류', { detail: error.message });
    });

    await this.session.connect();
    this.runtime.start();

    this.startTimers();
  }

  private startTimers(): void {
    this.heartbeatTimer = setInterval(() => {
      void this.deps.repositories.runtime.heartbeat(
        this.deps.tenantId,
        this.runtime?.stats ?? null
      );
    }, HEARTBEAT_INTERVAL_MS);

    this.persistTimer = setInterval(() => void this.persist(), PERSIST_INTERVAL_MS);

    // 대시보드가 바꾼 설정을 주워 옵니다. API 가 명시적으로 알려주는 경로도 있지만
    // (`reloadConfig`), 그 신호를 놓쳐도 30초 안에는 반영되도록 안전망을 둡니다.
    this.configTimer = setInterval(() => {
      void this.config?.refresh().catch((error: unknown) => {
        this.log.warn('설정 새로고침에 실패했습니다.', error);
      });
    }, this.deps.configRefreshMs);

    for (const timer of [this.heartbeatTimer, this.persistTimer, this.configTimer]) {
      timer.unref?.();
    }
  }

  private async onJoinChange(joined: boolean, by: string | null): Promise<void> {
    await this.deps.repositories.runtime.setStatus(this.deps.tenantId, {
      status: joined ? 'JOINED' : 'IDLE',
      joinedBy: by,
      joinedAt: joined ? new Date() : null,
      chatChannelId: this.runtime?.lastChatChannelId ?? null,
    });
    this.log.info(joined ? `입장 (${by ?? '대시보드'})` : '퇴장');
  }

  // ─── 외부에서 호출하는 제어 ────────────────────────────────────────────────

  /** 대시보드 버튼으로 입장/퇴장시킵니다. */
  setJoined(joined: boolean, by: string | null): void {
    this.runtime?.setJoined(joined, by);
  }

  /** 설정이 바뀌었다는 신호. API 가 저장 직후 부릅니다. */
  async reloadConfig(): Promise<void> {
    await this.config?.refresh();
    this.runtime?.syncTimers();
  }

  /** 채팅을 거치지 않고 명령을 실행합니다. */
  async executeCommand(request: ExecuteCommandRequest): Promise<ExecuteCommandResponse> {
    if (!this.runtime) {
      return {
        handled: false,
        output: '',
        source: 'none',
        broadcast: false,
        blockedReason: '봇이 실행 중이 아닙니다.',
        elapsedMs: 0,
      };
    }
    return this.runtime.executeCommand(request);
  }

  state(): BotInstanceState {
    return {
      tenantId: this.deps.tenantId,
      status: this.runtime ? (this.runtime.isJoined ? 'JOINED' : 'IDLE') : 'STOPPED',
      joinedBy: this.runtime?.joinedBy ?? null,
      joinedAt: null,
      chatChannelId: this.runtime?.lastChatChannelId ?? null,
      lastHeartbeatAt: new Date().toISOString(),
      lastError: null,
      stats: this.runtime?.stats ?? null,
    };
  }

  /** 대시보드가 읽는 실시간 값들 */
  get views() {
    return {
      viewers: this.viewers,
      songs: this.songs,
      events: this.events,
      chzzk: this.chzzk,
      lastChatChannelId: this.runtime?.lastChatChannelId,
    };
  }

  // ─── 종료 ──────────────────────────────────────────────────────────────────

  async stop(reason = '중지됨'): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;

    this.runtime?.stop();
    await this.teardown();

    await this.deps.repositories.runtime.setStatus(this.deps.tenantId, {
      status: 'STOPPED',
      workerId: null,
      joinedBy: null,
      joinedAt: null,
      lastError: null,
    });
    this.log.info(reason);
  }

  /**
   * 자원을 정리합니다.
   *
   * 저장이 **먼저**입니다. 세션부터 닫으면 그 사이 들어온 채팅으로 갱신된
   * 포인트를 잃습니다. 순서를 바꾸지 마세요.
   */
  private async teardown(): Promise<void> {
    for (const timer of [this.heartbeatTimer, this.persistTimer, this.configTimer]) {
      if (timer) clearInterval(timer);
    }
    this.heartbeatTimer = undefined;
    this.persistTimer = undefined;
    this.configTimer = undefined;

    await this.persist();
    await this.session?.close().catch(() => undefined);
    this.session = undefined;
  }

  /** 메모리에 쌓인 변경분을 전부 내려씁니다. */
  private async persist(): Promise<void> {
    await Promise.allSettled([this.viewers?.flush(), this.songs?.flush(), this.events?.flush()]);
  }
}

function describeError(error: unknown): string {
  if (error instanceof ChzzkApiError) {
    if (error.isRateLimited) {
      return '치지직 세션 연결 제한을 초과했습니다. 잠시 후 다시 시도합니다.';
    }
    return error.message.split('—').pop()?.trim() ?? error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
