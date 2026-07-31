import {
  buildAuthorizeUrl,
  ChzzkClient,
  exchangeCodeForToken,
  generateState,
  toStoredToken,
  type OAuthConfig,
} from '@chzzk-bot/chzzk-sdk';
import type { Repositories } from '@chzzk-bot/database';
import { noopLogger, type Logger } from '@chzzk-bot/logger';
import { TRIAL_DAYS } from '@chzzk-bot/platform-config';
import {
  defaultConfig,
  starterConfig,
  TRIAL_PLAN_CODE,
  type SessionUser,
} from '@chzzk-bot/contracts';
import type { SessionService } from './sessions.js';
import type { TokenVault } from './tokenVault.js';

export interface LoginFlowOptions {
  oauth: OAuthConfig;
  repositories: Repositories;
  sessions: SessionService;
  vault: TokenVault;
  logger?: Logger;
}

export interface LoginResult {
  sessionToken: string;
  expiresAt: Date;
  session: SessionUser;
  /** 이번 로그인으로 계정이 처음 만들어졌는지 (온보딩 화면 분기에 씁니다) */
  isNewUser: boolean;
}

/**
 * 치지직 계정으로 로그인하는 전체 흐름.
 *
 * 별도 회원가입을 만들지 않은 이유는, 이 서비스에서 사람을 식별하는 값이 결국
 * **치지직 채널 ID** 이기 때문입니다. 이메일로 가입시키면 "이 계정이 어느 채널의
 * 주인인가" 를 다시 증명받아야 하고, 그 증명이 결국 치지직 OAuth 입니다.
 * 한 단계로 끝낼 수 있는 일을 두 단계로 만들 이유가 없습니다.
 */
export class LoginFlow {
  private readonly log: Logger;

  constructor(private readonly options: LoginFlowOptions) {
    this.log = (options.logger ?? noopLogger).child('login');
  }

  /** 1단계 — 치지직으로 보낼 주소와 CSRF state 를 만듭니다. */
  begin(): { url: string; state: string } {
    return buildAuthorizeUrl(this.options.oauth, { state: generateState() });
  }

  /**
   * 2단계 — 돌아온 인가 코드를 세션으로 바꿉니다.
   *
   * 여기서 일어나는 일이 많은데, 전부 한 번에 끝나야 합니다. 중간에 멈추면
   * "로그인은 됐는데 채널이 없는" 계정이 남고, 사용자는 빈 대시보드를 보게 됩니다.
   *   ① 토큰 교환 → ② 내 채널 정보 조회 → ③ 계정 upsert → ④ 토큰 저장
   *   → ⑤ 첫 로그인이면 채널·설정·체험 구독 생성 → ⑥ 세션 발급
   */
  async complete(
    params: { code: string; state: string },
    context: { userAgent?: string | undefined; ip?: string | undefined } = {}
  ): Promise<LoginResult> {
    const { oauth, repositories, sessions, vault } = this.options;

    const tokenResponse = await exchangeCodeForToken(oauth, params);
    const stored = toStoredToken(tokenResponse);

    // 방금 받은 토큰으로 "나는 누구인가" 를 물어봅니다. 이 응답의 채널 ID 가
    // 우리 쪽 계정 식별자가 됩니다.
    const probe = new ChzzkClient({
      clientId: oauth.clientId,
      clientSecret: oauth.clientSecret,
      tokenProvider: { getAccessToken: () => Promise.resolve(stored.accessToken) },
      logger: this.log,
    });
    const me = await probe.users.me();

    // 프로필 이미지는 /users/me 에 없어서 채널 조회로 따로 받습니다.
    // 없어도 로그인은 되어야 하므로 실패는 삼킵니다.
    const channel = await probe.channels.get(me.channelId).catch(() => null);

    const existing = await repositories.users.findByChannelId(me.channelId);
    const isNewUser = existing === null;

    const user = await repositories.users.upsertFromChzzk({
      chzzkChannelId: me.channelId,
      channelName: me.channelName,
      profileImageUrl: channel?.channelImageUrl ?? null,
    });

    await vault.store(user.id, {
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      expiresAt: stored.expiresAt,
      ...(stored.scope ? { scope: stored.scope } : {}),
    });

    if (isNewUser) {
      await this.provisionFirstTenant(user.id, me.channelId, me.channelName);
    }

    const { token, expiresAt } = await sessions.create(user.id, context);
    const tenants = await repositories.tenants.listForUser(user.id);

    this.log.info(`${me.channelName}(${me.channelId}) 로그인${isNewUser ? ' — 신규 가입' : ''}`);

    return {
      sessionToken: token,
      expiresAt,
      isNewUser,
      session: {
        user: {
          id: user.id,
          chzzkChannelId: user.chzzkChannelId,
          channelName: user.channelName,
          profileImageUrl: user.profileImageUrl,
          email: user.email,
          platformRole: user.platformRole,
          status: user.status,
          createdAt: user.createdAt.toISOString(),
          lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        },
        tenants,
        activeTenantId: tenants[0]?.id ?? null,
      },
    };
  }

  /**
   * 가입 직후 채널 하나를 만들어 둡니다.
   *
   * 예시 명령어(`!멤버`, `!디스코드`)를 함께 넣는 게 중요합니다. 빈 대시보드를
   * 받은 사람은 무엇부터 해야 할지 몰라 그대로 나가고, 우리는 그 이유를 영영
   * 알 수 없습니다. 만들어진 걸 고치는 편이 처음부터 만드는 것보다 쉽습니다.
   */
  private async provisionFirstTenant(
    userId: string,
    chzzkChannelId: string,
    channelName: string
  ): Promise<void> {
    const { repositories } = this.options;

    const tenant = await repositories.tenants.createForOwner({
      ownerId: userId,
      chzzkChannelId,
      channelName,
    });

    await repositories.botConfig.initialize(tenant.id, starterConfig());

    const trialPlan = await repositories.subscriptions.findPlanByCode(TRIAL_PLAN_CODE);
    if (!trialPlan) {
      // 시드를 안 돌린 환경입니다. 로그인 자체를 막을 이유는 없으니 알리고 넘어갑니다.
      this.log.warn(
        `${TRIAL_PLAN_CODE} 플랜이 없어 체험 구독을 만들지 못했습니다. \`pnpm db:seed\` 를 실행하세요.`
      );
      return;
    }

    const now = new Date();
    const trialEnd = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);

    await repositories.subscriptions.create({
      tenantId: tenant.id,
      planId: trialPlan.id,
      status: 'TRIALING',
      currentPeriodStart: now,
      currentPeriodEnd: trialEnd,
      trialEndsAt: trialEnd,
    });
  }
}

/** 설정을 아직 만들지 않은 채널을 위한 기본값 — 테스트에서 함께 씁니다. */
export { defaultConfig };
