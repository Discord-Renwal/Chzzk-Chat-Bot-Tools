import type { TokenVault } from '@chzzk-bot/auth';
import type { Repositories } from '@chzzk-bot/database';
import { noopLogger, type Logger } from '@chzzk-bot/logger';
import type { CoreEnv } from '@chzzk-bot/platform-config';
import { TenantBot } from './tenantBot.js';

/** 맡아야 할 채널 목록을 다시 확인하는 주기 */
const RECONCILE_INTERVAL_MS = 60_000;

/**
 * 이 워커가 맡은 봇들을 관리합니다.
 *
 * 핵심은 **선언적 조정(reconcile)** 입니다. "구독이 살아 있는 채널" 이라는
 * 바라는 상태를 DB 에서 읽고, 지금 돌고 있는 것과 비교해 차이만 메웁니다.
 * 이벤트 하나하나에 반응해 start/stop 을 호출하는 방식이면, 이벤트를 한 번
 * 놓쳤을 때 그 채널은 다음 재시작까지 영영 돌아오지 않습니다. 조정 방식은
 * 신호를 놓쳐도 다음 주기에 저절로 맞춰집니다.
 */
export class BotSupervisor {
  private readonly bots = new Map<string, TenantBot>();
  private readonly log: Logger;
  private reconcileTimer: NodeJS.Timeout | undefined;
  private reconciling = false;
  private shuttingDown = false;

  constructor(
    private readonly deps: {
      env: CoreEnv;
      repositories: Repositories;
      vault: TokenVault;
      logger?: Logger;
    }
  ) {
    this.log = (deps.logger ?? noopLogger).child('supervisor');
  }

  async start(): Promise<void> {
    // 앞서 죽은 워커가 남긴 상태를 먼저 치웁니다. 그러지 않으면 그 채널들이
    // "이미 누가 맡고 있다" 로 보여 아무도 집어가지 않습니다.
    const reaped = await this.deps.repositories.runtime.reapStale();
    if (reaped > 0) this.log.warn(`응답 없는 봇 ${reaped}개를 정리했습니다.`);

    await this.reconcile();

    this.reconcileTimer = setInterval(() => void this.reconcile(), RECONCILE_INTERVAL_MS);
    this.reconcileTimer.unref?.();
  }

  get(tenantId: string): TenantBot | undefined {
    return this.bots.get(tenantId);
  }

  get size(): number {
    return this.bots.size;
  }

  /**
   * 바라는 상태와 현재 상태를 맞춥니다.
   *
   * 겹쳐 돌지 않게 막는 이유는, 앞선 조정이 세션을 여는 중일 때 다음 조정이
   * "아직 없다" 고 판단해 같은 채널의 봇을 하나 더 만들 수 있기 때문입니다.
   * 치지직 유저 세션은 동시 3개 제한이 있어 그 즉시 429 가 납니다.
   */
  async reconcile(): Promise<void> {
    if (this.reconciling || this.shuttingDown) return;
    this.reconciling = true;

    try {
      const desired = await this.deps.repositories.runtime.listStartable(
        this.deps.env.CORE_MAX_TENANTS
      );
      const desiredIds = new Set(desired.map((t) => t.tenantId));

      // 더 이상 자격이 없는 채널을 내립니다 (구독 만료·정지·사용자 탈퇴).
      for (const [tenantId, bot] of this.bots) {
        if (!desiredIds.has(tenantId)) {
          await bot.stop('구독이 종료되어 봇을 내립니다.');
          this.bots.delete(tenantId);
        }
      }

      for (const { tenantId } of desired) {
        if (this.bots.has(tenantId)) continue;
        await this.spawn(tenantId);
      }
    } catch (error) {
      this.log.error('조정 중 오류', error);
    } finally {
      this.reconciling = false;
    }
  }

  private async spawn(tenantId: string): Promise<void> {
    const { repositories, env, vault } = this.deps;

    const tenant = await repositories.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { owner: { include: { oauthAccount: { select: { id: true } } } } },
    });
    if (!tenant) return;

    // 토큰이 없으면 세션을 열 수 없습니다. 시도해서 실패하는 대신 그 사실을
    // 그대로 남깁니다 — 사용자에게 보여줄 안내가 "다시 로그인" 으로 달라집니다.
    if (!tenant.owner.oauthAccount) {
      await repositories.runtime.setStatus(tenantId, {
        status: 'ERROR',
        lastError: '치지직 계정 연결이 필요합니다. 다시 로그인해 주세요.',
      });
      return;
    }

    const bot = new TenantBot({
      tenantId,
      ownerId: tenant.ownerId,
      chzzkChannelId: tenant.chzzkChannelId,
      channelName: tenant.channelName,
      repositories,
      vault,
      clientId: env.CHZZK_CLIENT_ID,
      clientSecret: env.CHZZK_CLIENT_SECRET,
      workerId: env.CORE_WORKER_ID,
      configRefreshMs: env.CORE_CONFIG_REFRESH_MS,
      logger: this.log,
    });

    // 실패해도 맵에 넣습니다. 넣지 않으면 다음 조정마다 다시 시도해, 토큰이
    // 만료된 채널 하나가 1분마다 치지직에 실패 요청을 보내게 됩니다.
    // 상태는 ERROR 로 남아 있고, 사용자가 다시 로그인하면 API 가 restart 를 부릅니다.
    this.bots.set(tenantId, bot);
    await bot.start();
  }

  /** 사용자가 봇을 껐다 켜거나, 다시 로그인한 뒤 API 가 부릅니다. */
  async restart(tenantId: string): Promise<boolean> {
    const existing = this.bots.get(tenantId);
    if (existing) {
      await existing.stop('재시작합니다.');
      this.bots.delete(tenantId);
    }
    await this.spawn(tenantId);
    return this.bots.has(tenantId);
  }

  async stopTenant(tenantId: string): Promise<boolean> {
    const bot = this.bots.get(tenantId);
    if (!bot) return false;
    await bot.stop('사용자가 중지했습니다.');
    this.bots.delete(tenantId);
    return true;
  }

  /**
   * 전부 내리고 남은 데이터를 저장합니다.
   *
   * 순차로 도는 이유는 종료 중 DB 커넥션 풀을 다 써버리지 않기 위해서입니다.
   * 채널이 200개여도 각 봇의 마지막 저장은 수십 ms 라 전체가 몇 초 안에 끝납니다.
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);

    this.log.info(`봇 ${this.bots.size}개를 정리합니다.`);
    for (const bot of this.bots.values()) {
      await bot.stop('워커가 종료됩니다.').catch((error: unknown) => {
        this.log.error(`${bot.tenantId} 종료 중 오류`, error);
      });
    }
    this.bots.clear();
  }
}
