import type { AdminUserRow, PlatformRole, UserProfile } from '@chzzk-bot/contracts';
import type { Prisma, PrismaClient, User } from '../client.js';

export interface ChzzkIdentity {
  chzzkChannelId: string;
  channelName: string;
  profileImageUrl?: string | null;
}

/**
 * 서비스 계정 저장소.
 *
 * "사용자" 라는 말이 이 저장소에서는 **우리 서비스에 로그인한 사람**만 가리킵니다.
 * 채팅으로 지나가는 시청자는 `ViewerRepository` 쪽이며 계정이 없습니다. 둘을
 * 한 테이블에 담으면 시청자 수십만 명이 회원 수로 잡혀 지표가 전부 망가집니다.
 */
export class UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { id, deletedAt: null } });
  }

  async findByChannelId(chzzkChannelId: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { chzzkChannelId, deletedAt: null } });
  }

  /**
   * 로그인 시점에 부릅니다. 없으면 만들고, 있으면 프로필을 최신으로 맞춥니다.
   *
   * 채널명과 프로필 이미지는 치지직 쪽에서 바뀝니다. 로그인 때마다 새로 받는 게
   * 가장 싸고 정확한 동기화 방법입니다.
   */
  async upsertFromChzzk(identity: ChzzkIdentity): Promise<User> {
    return this.prisma.user.upsert({
      where: { chzzkChannelId: identity.chzzkChannelId },
      create: {
        chzzkChannelId: identity.chzzkChannelId,
        channelName: identity.channelName,
        profileImageUrl: identity.profileImageUrl ?? null,
        lastLoginAt: new Date(),
      },
      update: {
        channelName: identity.channelName,
        profileImageUrl: identity.profileImageUrl ?? null,
        lastLoginAt: new Date(),
      },
    });
  }

  async setPlatformRole(userId: string, platformRole: PlatformRole): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { platformRole } });
  }

  async suspend(userId: string, reason: string, until: Date | null): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: 'SUSPENDED', suspendedReason: reason, suspendedUntil: until },
    });
  }

  async reinstate(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: 'ACTIVE', suspendedReason: null, suspendedUntil: null },
    });
  }

  /**
   * 탈퇴. 행을 지우지 않고 표시만 합니다.
   *
   * 결제 기록은 법적으로 5년 보관해야 하고, 그 기록은 사용자를 참조합니다.
   * 실제로 지우면 매출 집계에 주인 없는 결제가 남습니다. 대신 개인정보에
   * 해당하는 필드는 즉시 비웁니다.
   */
  async softDelete(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          status: 'DELETED',
          deletedAt: new Date(),
          email: null,
          profileImageUrl: null,
          channelName: '탈퇴한 사용자',
        },
      }),
      this.prisma.oAuthAccount.deleteMany({ where: { userId } }),
      this.prisma.session.deleteMany({ where: { userId } }),
    ]);
  }

  /** 내부 관리자 목록 화면 */
  async listAll(
    filter: {
      q?: string | undefined;
      status?: User['status'] | undefined;
      platformRole?: PlatformRole | undefined;
      sort?: 'createdAt' | 'lastLoginAt' | 'channelName';
      order?: 'asc' | 'desc';
    },
    page: { page: number; size: number }
  ): Promise<{ rows: AdminUserRow[]; total: number }> {
    const where: Prisma.UserWhereInput = {
      ...(filter.status ? { status: filter.status } : { status: { not: 'DELETED' } }),
      ...(filter.platformRole ? { platformRole: filter.platformRole } : {}),
      ...(filter.q
        ? {
            OR: [
              { channelName: { contains: filter.q, mode: 'insensitive' } },
              { chzzkChannelId: { contains: filter.q } },
              { email: { contains: filter.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: {
          ownedTenants: {
            where: { deletedAt: null },
            include: { subscription: { include: { plan: true } } },
          },
        },
        orderBy: { [filter.sort ?? 'createdAt']: filter.order ?? 'desc' },
        skip: (page.page - 1) * page.size,
        take: page.size,
      }),
      this.prisma.user.count({ where }),
    ]);

    // 누적 결제액은 목록마다 조인하면 무거워서, 이 페이지에 나온 사람만 한 번에 셉니다.
    const tenantIds = rows.flatMap((u) => u.ownedTenants.map((t) => t.id));
    const revenueByTenant = new Map<string, number>();

    if (tenantIds.length > 0) {
      const sums = await this.prisma.payment.groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: tenantIds }, status: { in: ['PAID', 'PARTIAL_REFUNDED'] } },
        _sum: { amount: true, refundedAmount: true },
      });
      for (const row of sums) {
        revenueByTenant.set(row.tenantId, (row._sum.amount ?? 0) - (row._sum.refundedAmount ?? 0));
      }
    }

    return {
      total,
      rows: rows.map((user) => {
        const primary = user.ownedTenants[0];
        return {
          id: user.id,
          chzzkChannelId: user.chzzkChannelId,
          channelName: user.channelName,
          profileImageUrl: user.profileImageUrl,
          email: user.email,
          platformRole: user.platformRole,
          status: user.status,
          createdAt: user.createdAt.toISOString(),
          lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
          tenantCount: user.ownedTenants.length,
          planCode: primary?.subscription?.plan.code ?? null,
          subscriptionStatus: primary?.subscription?.status ?? null,
          lifetimeRevenue: user.ownedTenants.reduce(
            (sum, t) => sum + (revenueByTenant.get(t.id) ?? 0),
            0
          ),
        };
      }),
    };
  }
}

export function toUserProfile(user: User): UserProfile {
  return {
    id: user.id,
    chzzkChannelId: user.chzzkChannelId,
    channelName: user.channelName,
    profileImageUrl: user.profileImageUrl,
    email: user.email,
    platformRole: user.platformRole,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}
