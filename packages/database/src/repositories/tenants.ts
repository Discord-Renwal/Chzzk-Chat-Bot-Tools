import type { TenantRole, TenantSummary } from '@chzzk-bot/contracts';
import type { Prisma, PrismaClient, Tenant } from '../client.js';

/**
 * 테넌트(채널 워크스페이스) 저장소.
 *
 * `slug` 는 사람이 URL 에서 읽는 값이라 채널명에서 만들되, 채널명은 한글·이모지·
 * 공백이 섞여 있어 그대로 쓸 수 없습니다. 아래 `toSlug` 가 그 변환을 맡습니다.
 */
export class TenantRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Tenant | null> {
    return this.prisma.tenant.findFirst({ where: { id, deletedAt: null } });
  }

  async findByChannelId(chzzkChannelId: string): Promise<Tenant | null> {
    return this.prisma.tenant.findFirst({ where: { chzzkChannelId, deletedAt: null } });
  }

  /** 이 사람이 접근할 수 있는 채널 목록 (소유 + 매니저로 초대된 곳) */
  async listForUser(userId: string): Promise<TenantSummary[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, tenant: { deletedAt: null } },
      include: { tenant: true },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((m) => ({
      id: m.tenant.id,
      slug: m.tenant.slug,
      chzzkChannelId: m.tenant.chzzkChannelId,
      channelName: m.tenant.channelName,
      status: m.tenant.status,
      role: m.role,
      createdAt: m.tenant.createdAt.toISOString(),
    }));
  }

  /** 이 사람이 그 채널에서 갖는 역할. 소속이 아니면 null */
  async roleOf(tenantId: string, userId: string): Promise<TenantRole | null> {
    const membership = await this.prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });
    return membership?.role ?? null;
  }

  /**
   * 로그인한 사람의 채널을 만듭니다 — 소유자 멤버십까지 한 트랜잭션으로.
   *
   * 둘을 나눠 쓰면 멤버십 생성이 실패했을 때 주인이 자기 채널에 못 들어가는
   * 유령 테넌트가 남습니다.
   */
  async createForOwner(input: {
    ownerId: string;
    chzzkChannelId: string;
    channelName: string;
  }): Promise<Tenant> {
    const slug = await this.uniqueSlug(input.channelName, input.chzzkChannelId);

    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          slug,
          chzzkChannelId: input.chzzkChannelId,
          channelName: input.channelName,
          ownerId: input.ownerId,
        },
      });

      await tx.membership.create({
        data: { tenantId: tenant.id, userId: input.ownerId, role: 'OWNER' },
      });

      return tenant;
    });
  }

  async updateStatus(tenantId: string, status: Tenant['status'], reason?: string): Promise<void> {
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { status, suspendedReason: reason ?? null },
    });
  }

  /**
   * 매니저를 초대합니다.
   *
   * 치지직 채널 매니저와 자동으로 동기화하지 않는 이유는, 채팅 매니저 권한과
   * "봇 설정을 바꿀 권한" 이 같은 것이 아니기 때문입니다. 스트리머가 명시적으로
   * 초대해야 합니다.
   */
  async addMember(tenantId: string, userId: string, role: TenantRole): Promise<void> {
    await this.prisma.membership.upsert({
      where: { tenantId_userId: { tenantId, userId } },
      create: { tenantId, userId, role },
      update: { role },
    });
  }

  async removeMember(tenantId: string, userId: string): Promise<boolean> {
    // 주인을 내보내면 아무도 결제와 삭제를 못 하는 채널이 됩니다.
    const membership = await this.prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });
    if (!membership || membership.role === 'OWNER') return false;

    await this.prisma.membership.delete({ where: { id: membership.id } });
    return true;
  }

  /** 내부 관리자 목록 화면 */
  async listAll(
    filter: { q?: string | undefined; status?: Tenant['status'] | undefined },
    page: { page: number; size: number }
  ) {
    const where: Prisma.TenantWhereInput = {
      deletedAt: null,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.q
        ? {
            OR: [
              { channelName: { contains: filter.q, mode: 'insensitive' } },
              { chzzkChannelId: { contains: filter.q } },
              { slug: { contains: filter.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        include: {
          owner: true,
          subscription: { include: { plan: true } },
          instance: true,
          _count: { select: { members: true, commands: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page.page - 1) * page.size,
        take: page.size,
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return { rows, total };
  }

  /**
   * 채널명에서 URL 에 쓸 수 있는 slug 를 만듭니다.
   *
   * 한글을 로마자로 옮기는 대신, 쓸 수 없는 문자만 걷어내고 남는 게 없으면
   * 채널 ID 앞자리를 씁니다. 억지 음역은 오히려 알아보기 어렵습니다.
   */
  private async uniqueSlug(channelName: string, chzzkChannelId: string): Promise<string> {
    const base = toSlug(channelName) || `ch-${chzzkChannelId.slice(0, 8)}`;

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const taken = await this.prisma.tenant.findUnique({ where: { slug: candidate } });
      if (!taken) return candidate;
    }
    // 50개까지 겹치는 건 사실상 없지만, 그때는 충돌하지 않는 값으로 끝냅니다.
    return `${base}-${chzzkChannelId.slice(0, 8)}`;
  }
}

export function toSlug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
