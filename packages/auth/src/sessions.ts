import type { PrismaClient } from '@chzzk-bot/database';
import { SESSION_TTL_MS } from '@chzzk-bot/platform-config';
import type { PlatformRole, UserStatus } from '@chzzk-bot/contracts';
import { generateToken, hashToken } from './crypto.js';

export interface AuthenticatedUser {
  id: string;
  chzzkChannelId: string;
  channelName: string;
  platformRole: PlatformRole;
  status: UserStatus;
}

/**
 * 로그인 세션.
 *
 * JWT 대신 DB 세션을 쓰는 이유는 **즉시 무효화**가 필요하기 때문입니다. 운영자가
 * 계정을 정지시키거나 사용자가 "다른 기기에서 로그아웃" 을 누르면 그 순간부터
 * 막혀야 합니다. 서명만 검사하는 JWT 로는 만료 전까지 막을 방법이 없습니다.
 *
 * 요청마다 DB 를 한 번 더 보는 비용은 있지만, 세션 조회는 유니크 인덱스 한 번이라
 * 무시할 수준입니다.
 */
export class SessionService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * 세션을 만들고 **원문 토큰**을 돌려줍니다.
   *
   * 원문은 이 순간에만 존재합니다. DB 에는 해시만 들어가므로, 여기서 돌려준
   * 값을 쿠키에 심지 못하면 그 세션은 영영 쓸 수 없습니다.
   */
  async create(
    userId: string,
    context: { userAgent?: string | undefined; ip?: string | undefined } = {}
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        userAgent: context.userAgent ?? null,
        ip: context.ip ?? null,
        expiresAt,
      },
    });

    return { token, expiresAt };
  }

  /**
   * 토큰으로 사용자를 찾습니다. 만료·폐기·정지된 계정은 전부 null 입니다.
   *
   * 정지 여부를 **여기서** 함께 보는 게 중요합니다. 각 라우트가 따로 확인하게
   * 두면 언젠가 한 군데를 빠뜨리고, 그 한 군데가 정지된 계정의 우회로가 됩니다.
   */
  async verify(token: string): Promise<AuthenticatedUser | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });

    if (!session) return null;
    if (session.revokedAt) return null;
    if (session.expiresAt.getTime() < Date.now()) return null;

    const { user } = session;
    if (user.deletedAt) return null;

    // 정지 기간이 지났으면 자동으로 풀어 줍니다. 사람이 다시 눌러야만 풀리면
    // "3일 정지" 가 사실상 무기한 정지가 됩니다.
    if (user.status === 'SUSPENDED') {
      const expired = user.suspendedUntil !== null && user.suspendedUntil.getTime() < Date.now();
      if (!expired) return null;

      await this.prisma.user.update({
        where: { id: user.id },
        data: { status: 'ACTIVE', suspendedReason: null, suspendedUntil: null },
      });
    }

    return {
      id: user.id,
      chzzkChannelId: user.chzzkChannelId,
      channelName: user.channelName,
      platformRole: user.platformRole,
      status: 'ACTIVE',
    };
  }

  async revoke(token: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { tokenHash: hashToken(token) },
      data: { revokedAt: new Date() },
    });
  }

  /** 이 사람의 모든 세션을 끊습니다. 계정 정지와 "모든 기기에서 로그아웃" 이 씁니다. */
  async revokeAllForUser(userId: string): Promise<number> {
    const { count } = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  /** 만료된 세션 정리. 하루 한 번 배치가 부릅니다. */
  async pruneExpired(): Promise<number> {
    const { count } = await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - SESSION_TTL_MS) } },
    });
    return count;
  }
}
