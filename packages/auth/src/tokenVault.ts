import {
  refreshToken as refreshChzzkToken,
  toStoredToken,
  type OAuthConfig,
  type TokenProvider,
} from '@chzzk-bot/chzzk-sdk';
import type { PrismaClient } from '@chzzk-bot/database';
import { noopLogger, type Logger } from '@chzzk-bot/logger';
import { decryptSecret, encryptSecret } from './crypto.js';

/** 만료 몇 ms 전부터 미리 갱신할지 — 기본 5분 */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export interface TokenVaultOptions {
  prisma: PrismaClient;
  oauth: OAuthConfig;
  /** base64 로 인코딩한 32바이트 키를 디코드한 값 */
  encryptionKey: Buffer;
  logger?: Logger;
}

/**
 * 사용자별 치지직 토큰 금고.
 *
 * 단일 채널 시절에는 토큰이 `.tokens/chzzk.json` 파일 하나였습니다. 멀티테넌트가
 * 되면서 사용자마다 다른 토큰을 들고, 각각 따로 갱신해야 합니다.
 *
 * 갱신에서 주의할 점이 두 가지 있습니다.
 *  1. 치지직의 리프레시 토큰은 **1회용**입니다. 갱신 응답의 새 리프레시 토큰을
 *     저장하지 못하면 그 사용자는 다시 로그인해야 합니다. 그래서 저장이 끝난
 *     뒤에야 액세스 토큰을 돌려줍니다.
 *  2. 같은 사용자에 대한 갱신이 동시에 여러 번 일어나면, 먼저 성공한 쪽이
 *     리프레시 토큰을 소모해 나머지가 전부 실패합니다. 진행 중인 갱신을 공유해
 *     막습니다.
 */
export class TokenVault {
  private readonly log: Logger;
  private readonly inflight = new Map<string, Promise<string>>();

  constructor(private readonly options: TokenVaultOptions) {
    this.log = (options.logger ?? noopLogger).child('token-vault');
  }

  /** 로그인·재인증 직후 토큰을 넣습니다. */
  async store(
    userId: string,
    token: { accessToken: string; refreshToken: string; expiresAt: number; scope?: string }
  ): Promise<void> {
    const { prisma, encryptionKey } = this.options;
    const data = {
      accessTokenEnc: encryptSecret(token.accessToken, encryptionKey),
      refreshTokenEnc: encryptSecret(token.refreshToken, encryptionKey),
      accessTokenExpires: new Date(token.expiresAt),
      scope: token.scope ?? '',
    };

    await prisma.oAuthAccount.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }

  /** 저장된 토큰을 지웁니다(탈퇴·연동 해제). */
  async revoke(userId: string): Promise<void> {
    await this.options.prisma.oAuthAccount.deleteMany({ where: { userId } });
  }

  /**
   * 이 사용자로 치지직 API 를 부를 수 있는 TokenProvider 를 만듭니다.
   *
   * `ChzzkClient` 는 이것만 받으면 나머지를 모르고도 동작합니다 — 토큰이 어디에
   * 저장돼 있고 언제 갱신되는지는 금고의 사정입니다.
   */
  providerFor(userId: string): TokenProvider {
    return {
      getAccessToken: () => this.getAccessToken(userId),
      refreshAccessToken: () => this.refresh(userId),
    };
  }

  async getAccessToken(userId: string): Promise<string> {
    const account = await this.options.prisma.oAuthAccount.findUnique({ where: { userId } });
    if (!account) {
      throw new Error('치지직 계정이 연결돼 있지 않습니다. 다시 로그인해 주세요.');
    }

    if (Date.now() < account.accessTokenExpires.getTime() - REFRESH_MARGIN_MS) {
      return decryptSecret(account.accessTokenEnc, this.options.encryptionKey);
    }

    this.log.debug(`${userId} 의 액세스 토큰 만료가 임박해 미리 갱신합니다.`);
    return this.refresh(userId);
  }

  async refresh(userId: string): Promise<string> {
    const existing = this.inflight.get(userId);
    if (existing) return existing;

    const promise = this.doRefresh(userId).finally(() => this.inflight.delete(userId));
    this.inflight.set(userId, promise);
    return promise;
  }

  private async doRefresh(userId: string): Promise<string> {
    const { prisma, encryptionKey, oauth } = this.options;

    const account = await prisma.oAuthAccount.findUnique({ where: { userId } });
    if (!account) throw new Error('갱신할 리프레시 토큰이 없습니다. 다시 로그인해 주세요.');

    const current = decryptSecret(account.refreshTokenEnc, encryptionKey);
    const response = await refreshChzzkToken(oauth, current);
    const next = toStoredToken(response);

    await this.store(userId, {
      accessToken: next.accessToken,
      refreshToken: next.refreshToken,
      expiresAt: next.expiresAt,
      ...(next.scope ? { scope: next.scope } : {}),
    });

    this.log.info(`${userId} 의 액세스 토큰을 갱신했습니다.`);
    return next.accessToken;
  }
}
