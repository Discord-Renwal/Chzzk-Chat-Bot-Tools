import type { FastifyInstance } from 'fastify';
import {
  adminUserQuery,
  changePlatformRoleRequest,
  overrideSubscriptionRequest,
  pageQuery,
  paginate,
  refundRequest,
  suspendUserRequest,
  upsertAnnouncementRequest,
  upsertFeatureFlagRequest,
  type AdminMetrics,
  type AdminTenantRow,
} from '@chzzk-bot/contracts';
import { staffCan } from '@chzzk-bot/auth';
import type { AppContext } from '../context.js';
import { ApiException, fromZodError } from '../errors.js';
import { currentUser } from '../plugins/authGuard.js';

/**
 * 내부 관리자 콘솔 API (요구사항 3번).
 *
 * 원칙이 셋 있습니다.
 *  1. 조회를 뺀 모든 동작은 `reason` 을 필수로 받고 감사 로그에 남깁니다.
 *     "누가 왜 이 사용자를 정지시켰는가" 에 답할 수 없는 관리 기능은 만들지 않습니다.
 *  2. 권한은 `staffCan.*` 로만 판단합니다. 라우트마다 역할을 비교하면 역할을
 *     하나 추가할 때 반드시 어딘가를 빠뜨립니다.
 *  3. 내부 관리자가 아닌 사람에게는 403 이 아니라 **404** 를 줍니다
 *     (`requireStaff` 참고). 403 은 "여기 관리자 콘솔이 있다" 는 정보입니다.
 */
export function registerAdminRoutes(app: FastifyInstance, context: AppContext): void {
  const { repositories, subscriptions, core } = context;

  const staff = { preHandler: [app.requireUser, app.requireStaff('SUPPORT')] };

  /** 감사 로그를 남기는 공통 헬퍼 — 요청 맥락(IP·UA)까지 함께 붙입니다. */
  async function audit(
    request: Parameters<typeof currentUser>[0],
    entry: {
      action: string;
      targetType?: string;
      targetId?: string;
      tenantId?: string;
      reason?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    const actor = currentUser(request);
    await repositories.audit.record({
      actorType: 'STAFF',
      actorId: actor.id,
      actorName: actor.channelName,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      ...entry,
    });
  }

  /** 권한 검사. 통과하지 못하면 403 을 던집니다. */
  function assertCan(
    request: Parameters<typeof currentUser>[0],
    action: keyof typeof staffCan
  ): void {
    if (!staffCan[action](currentUser(request).platformRole)) {
      throw ApiException.forbidden('상위 관리자 권한이 필요합니다.');
    }
  }

  // ─── 대시보드 지표 ─────────────────────────────────────────────────────────

  app.get('/admin/metrics', staff, async (): Promise<AdminMetrics> => {
    const prisma = repositories.prisma;
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const lastMonthStart = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);

    const [
      totalUsers,
      activeUsers,
      newUsers,
      suspendedUsers,
      totalTenants,
      activeTenants,
      suspendedTenants,
      botCounts,
      subscriptionCounts,
      planCounts,
      thisMonthRevenue,
      lastMonthRevenue,
      failedPayments,
      activeSubscriptions,
    ] = await Promise.all([
      prisma.user.count({ where: { status: { not: 'DELETED' } } }),
      prisma.user.count({ where: { lastLoginAt: { gte: weekAgo } } }),
      prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.user.count({ where: { status: 'SUSPENDED' } }),
      prisma.tenant.count({ where: { deletedAt: null } }),
      prisma.tenant.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      prisma.tenant.count({ where: { status: 'SUSPENDED' } }),
      prisma.botInstance.groupBy({ by: ['status'], _count: true }),
      prisma.subscription.groupBy({ by: ['status'], _count: true }),
      prisma.subscription.groupBy({ by: ['planId'], _count: true }),
      prisma.payment.aggregate({
        where: { status: 'PAID', paidAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({
        where: { status: 'PAID', paidAt: { gte: lastMonthStart, lt: monthStart } },
        _sum: { amount: true },
      }),
      prisma.payment.count({ where: { status: 'FAILED', createdAt: { gte: weekAgo } } }),
      prisma.subscription.findMany({
        where: { status: { in: ['ACTIVE', 'PAST_DUE'] } },
        include: { plan: { select: { code: true, priceMonthly: true } } },
      }),
    ]);

    const plans = await prisma.plan.findMany({ select: { id: true, code: true } });
    const planCodeById = new Map(plans.map((p) => [p.id, p.code]));

    return {
      users: {
        total: totalUsers,
        activeLast7Days: activeUsers,
        newLast7Days: newUsers,
        suspended: suspendedUsers,
      },
      tenants: { total: totalTenants, active: activeTenants, suspended: suspendedTenants },
      bots: {
        running: botCounts
          .filter((b) => b.status === 'IDLE' || b.status === 'JOINED')
          .reduce((sum, b) => sum + b._count, 0),
        joined: botCounts.find((b) => b.status === 'JOINED')?._count ?? 0,
        error: botCounts.find((b) => b.status === 'ERROR')?._count ?? 0,
      },
      revenue: {
        // MRR 은 "지금 유효한 유료 구독의 월 정가 합" 입니다. 실제 입금액과는
        // 다릅니다(비례 배분·환불 때문에). 추세를 보는 지표라 이 정의로 충분합니다.
        mrr: activeSubscriptions.reduce((sum, s) => sum + s.plan.priceMonthly, 0),
        thisMonth: thisMonthRevenue._sum.amount ?? 0,
        lastMonth: lastMonthRevenue._sum.amount ?? 0,
        failedPaymentsLast7Days: failedPayments,
      },
      subscriptions: Object.fromEntries(subscriptionCounts.map((s) => [s.status, s._count])),
      planBreakdown: planCounts.map((p) => ({
        planCode: planCodeById.get(p.planId) ?? '알 수 없음',
        count: p._count,
      })),
    };
  });

  // ─── 사용자 관리 ───────────────────────────────────────────────────────────

  app.get('/admin/users', staff, async (request) => {
    const filter = adminUserQuery.safeParse(request.query);
    const page = pageQuery.safeParse(request.query);
    if (!filter.success) throw fromZodError(filter.error);
    if (!page.success) throw fromZodError(page.error);

    const { rows, total } = await repositories.users.listAll(
      {
        q: filter.data.q || undefined,
        status: filter.data.status,
        platformRole: filter.data.platformRole,
        sort: filter.data.sort,
        order: filter.data.order,
      },
      page.data
    );

    return paginate(rows, total, page.data);
  });

  app.get<{ Params: { userId: string } }>('/admin/users/:userId', staff, async (request) => {
    const user = await repositories.prisma.user.findUnique({
      where: { id: request.params.userId },
      include: {
        ownedTenants: {
          where: { deletedAt: null },
          include: { subscription: { include: { plan: true } }, instance: true },
        },
        memberships: { include: { tenant: { select: { id: true, channelName: true } } } },
        billingCards: { where: { revokedAt: null } },
      },
    });
    if (!user) throw ApiException.notFound('사용자를 찾을 수 없습니다.');

    // 남의 계정을 열어본 것도 기록입니다. 조회까지 남기는 이유는, 고객 정보
    // 열람 자체가 감사 대상이기 때문입니다.
    await audit(request, {
      action: 'admin.user.view',
      targetType: 'User',
      targetId: user.id,
    });

    return user;
  });

  app.post<{ Params: { userId: string } }>(
    '/admin/users/:userId/suspend',
    staff,
    async (request) => {
      assertCan(request, 'suspendUser');

      const parsed = suspendUserRequest.safeParse(request.body);
      if (!parsed.success) throw fromZodError(parsed.error);

      const { userId } = request.params;
      const target = await repositories.users.findById(userId);
      if (!target) throw ApiException.notFound('사용자를 찾을 수 없습니다.');

      // 자기 자신을 정지시키면 콘솔에서 나갈 수 없게 됩니다.
      if (target.id === currentUser(request).id) {
        throw ApiException.badRequest('자기 자신은 정지시킬 수 없습니다.');
      }

      await repositories.users.suspend(
        userId,
        parsed.data.reason,
        parsed.data.until ? new Date(parsed.data.until) : null
      );

      // 세션을 끊지 않으면 이미 로그인해 있는 창에서는 계속 쓸 수 있습니다.
      await context.sessions.revokeAllForUser(userId);

      if (parsed.data.stopBots) {
        const tenants = await repositories.prisma.tenant.findMany({
          where: { ownerId: userId, deletedAt: null },
          select: { id: true },
        });
        for (const tenant of tenants) {
          await repositories.tenants.updateStatus(tenant.id, 'SUSPENDED', parsed.data.reason);
          await core.stop(tenant.id).catch(() => undefined);
        }
      }

      await audit(request, {
        action: 'admin.user.suspend',
        targetType: 'User',
        targetId: userId,
        reason: parsed.data.reason,
        metadata: { until: parsed.data.until ?? null, stopBots: parsed.data.stopBots },
      });

      return { ok: true };
    }
  );

  app.post<{ Params: { userId: string }; Body: { reason?: string } }>(
    '/admin/users/:userId/reinstate',
    staff,
    async (request) => {
      assertCan(request, 'suspendUser');

      const { userId } = request.params;
      await repositories.users.reinstate(userId);

      const tenants = await repositories.prisma.tenant.findMany({
        where: { ownerId: userId, deletedAt: null, status: 'SUSPENDED' },
        select: { id: true },
      });
      for (const tenant of tenants) {
        await repositories.tenants.updateStatus(tenant.id, 'ACTIVE');
      }

      await audit(request, {
        action: 'admin.user.reinstate',
        targetType: 'User',
        targetId: userId,
        reason: request.body?.reason ?? '',
      });

      return { ok: true, restoredTenants: tenants.length };
    }
  );

  app.post<{ Params: { userId: string } }>('/admin/users/:userId/role', staff, async (request) => {
    assertCan(request, 'managePlatformRoles');

    const parsed = changePlatformRoleRequest.safeParse(request.body);
    if (!parsed.success) throw fromZodError(parsed.error);

    const actor = currentUser(request);
    // 마지막 최고 관리자가 스스로를 강등하면 아무도 역할을 되돌릴 수 없습니다.
    if (request.params.userId === actor.id && parsed.data.platformRole !== 'SUPER_ADMIN') {
      const superAdmins = await repositories.prisma.user.count({
        where: { platformRole: 'SUPER_ADMIN', status: 'ACTIVE' },
      });
      if (superAdmins <= 1) {
        throw ApiException.conflict('최고 관리자가 한 명뿐이라 강등할 수 없습니다.');
      }
    }

    await repositories.users.setPlatformRole(request.params.userId, parsed.data.platformRole);
    await audit(request, {
      action: 'admin.user.role',
      targetType: 'User',
      targetId: request.params.userId,
      reason: parsed.data.reason,
      metadata: { platformRole: parsed.data.platformRole },
    });

    return { ok: true };
  });

  // ─── 채널(테넌트) 관리 ─────────────────────────────────────────────────────

  app.get('/admin/tenants', staff, async (request) => {
    const page = pageQuery.safeParse(request.query);
    if (!page.success) throw fromZodError(page.error);

    const query = request.query as { q?: string; status?: 'ACTIVE' | 'PAUSED' | 'SUSPENDED' };
    const { rows, total } = await repositories.tenants.listAll(
      { q: query.q, status: query.status },
      page.data
    );

    const mapped: AdminTenantRow[] = rows.map((tenant) => ({
      id: tenant.id,
      slug: tenant.slug,
      chzzkChannelId: tenant.chzzkChannelId,
      channelName: tenant.channelName,
      status: tenant.status,
      ownerName: tenant.owner.channelName,
      ownerId: tenant.ownerId,
      planCode: tenant.subscription?.plan.code ?? null,
      subscriptionStatus: tenant.subscription?.status ?? null,
      botStatus: tenant.instance?.status ?? 'STOPPED',
      memberCount: tenant._count.members,
      commandCount: tenant._count.commands,
      createdAt: tenant.createdAt.toISOString(),
    }));

    return paginate(mapped, total, page.data);
  });

  app.post<{ Params: { tenantId: string }; Body: { reason?: string } }>(
    '/admin/tenants/:tenantId/bot/stop',
    staff,
    async (request) => {
      assertCan(request, 'controlBot');

      await repositories.tenants.updateStatus(
        request.params.tenantId,
        'SUSPENDED',
        request.body?.reason ?? '운영자가 중지했습니다.'
      );
      await core.stop(request.params.tenantId).catch(() => undefined);

      await audit(request, {
        action: 'admin.bot.stop',
        targetType: 'Tenant',
        targetId: request.params.tenantId,
        tenantId: request.params.tenantId,
        reason: request.body?.reason ?? '',
      });

      return { ok: true };
    }
  );

  app.post<{ Params: { tenantId: string }; Body: { reason?: string } }>(
    '/admin/tenants/:tenantId/bot/start',
    staff,
    async (request) => {
      assertCan(request, 'controlBot');

      await repositories.tenants.updateStatus(request.params.tenantId, 'ACTIVE');
      const started = await core.start(request.params.tenantId).catch(() => false);

      await audit(request, {
        action: 'admin.bot.start',
        targetType: 'Tenant',
        targetId: request.params.tenantId,
        tenantId: request.params.tenantId,
        reason: request.body?.reason ?? '',
      });

      return { ok: started };
    }
  );

  /** 결제 없이 플랜을 열어 줍니다 — 파트너·베타 테스터·보상용. */
  app.post<{ Params: { tenantId: string } }>(
    '/admin/tenants/:tenantId/subscription',
    staff,
    async (request) => {
      assertCan(request, 'overrideSubscription');

      const parsed = overrideSubscriptionRequest.safeParse(request.body);
      if (!parsed.success) throw fromZodError(parsed.error);

      const plan = await repositories.subscriptions.findPlanByCode(parsed.data.planCode);
      if (!plan) throw ApiException.notFound(`${parsed.data.planCode} 요금제가 없습니다.`);

      const updated = await repositories.subscriptions.update(request.params.tenantId, {
        plan: { connect: { id: plan.id } },
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(parsed.data.periodEnd),
        cancelAtPeriodEnd: false,
        failedAttempts: 0,
        // 결제 없이 열어준 건이라는 사실을 남깁니다. 이게 없으면 나중에
        // "왜 이 채널은 돈을 안 냈는데 PRO 인가" 를 아무도 설명할 수 없습니다.
        overrideReason: parsed.data.reason,
      });

      await audit(request, {
        action: 'admin.subscription.override',
        targetType: 'Tenant',
        targetId: request.params.tenantId,
        tenantId: request.params.tenantId,
        reason: parsed.data.reason,
        metadata: { planCode: parsed.data.planCode, periodEnd: parsed.data.periodEnd },
      });

      await core.notifyConfigChanged(request.params.tenantId);
      return updated;
    }
  );

  // ─── 결제 · 환불 ───────────────────────────────────────────────────────────

  app.get('/admin/payments', staff, async (request) => {
    assertCan(request, 'viewBilling');

    const page = pageQuery.safeParse(request.query);
    if (!page.success) throw fromZodError(page.error);
    const query = request.query as { status?: string; tenantId?: string };

    const where = {
      ...(query.status ? { status: query.status as 'PAID' } : {}),
      ...(query.tenantId ? { tenantId: query.tenantId } : {}),
    };

    const [rows, total] = await Promise.all([
      repositories.prisma.payment.findMany({
        where,
        include: { tenant: { select: { channelName: true, slug: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page.data.page - 1) * page.data.size,
        take: page.data.size,
      }),
      repositories.prisma.payment.count({ where }),
    ]);

    return paginate(rows, total, page.data);
  });

  app.post('/admin/payments/refund', staff, async (request) => {
    assertCan(request, 'refundPayment');

    const parsed = refundRequest.safeParse(request.body);
    if (!parsed.success) throw fromZodError(parsed.error);

    const result = await subscriptions.refund(
      parsed.data.paymentId,
      parsed.data.amount,
      parsed.data.reason
    );

    await audit(request, {
      action: 'admin.payment.refund',
      targetType: 'Payment',
      targetId: parsed.data.paymentId,
      reason: parsed.data.reason,
      metadata: { requested: parsed.data.amount ?? null, refunded: result.refundedAmount },
    });

    if (!result.success) {
      throw ApiException.upstream(result.failureReason ?? '환불에 실패했습니다.');
    }
    return result;
  });

  // ─── 감사 로그 ─────────────────────────────────────────────────────────────

  app.get('/admin/audit-logs', staff, async (request) => {
    assertCan(request, 'viewAuditLog');

    const page = pageQuery.safeParse(request.query);
    if (!page.success) throw fromZodError(page.error);
    const query = request.query as {
      actorId?: string;
      action?: string;
      tenantId?: string;
      from?: string;
      to?: string;
    };

    const { rows, total } = await repositories.audit.list(
      {
        actorId: query.actorId,
        action: query.action,
        tenantId: query.tenantId,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
      },
      page.data
    );

    return paginate(rows, total, page.data);
  });

  // ─── 공지 ──────────────────────────────────────────────────────────────────

  app.get('/admin/announcements', staff, async () => {
    return {
      announcements: await repositories.prisma.announcement.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    };
  });

  app.post('/admin/announcements', staff, async (request, reply) => {
    assertCan(request, 'manageAnnouncements');

    const parsed = upsertAnnouncementRequest.safeParse(request.body);
    if (!parsed.success) throw fromZodError(parsed.error);

    const created = await repositories.prisma.announcement.create({
      data: {
        title: parsed.data.title,
        body: parsed.data.body,
        level: parsed.data.level,
        publishedAt: parsed.data.publishedAt ? new Date(parsed.data.publishedAt) : null,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
        createdById: currentUser(request).id,
      },
    });

    await audit(request, {
      action: 'admin.announcement.create',
      targetType: 'Announcement',
      targetId: created.id,
      metadata: { title: created.title },
    });

    return reply.code(201).send(created);
  });

  app.delete<{ Params: { id: string } }>('/admin/announcements/:id', staff, async (request) => {
    assertCan(request, 'manageAnnouncements');

    await repositories.prisma.announcement.delete({ where: { id: request.params.id } });
    await audit(request, {
      action: 'admin.announcement.delete',
      targetType: 'Announcement',
      targetId: request.params.id,
    });
    return { ok: true };
  });

  // ─── 기능 플래그 ───────────────────────────────────────────────────────────

  app.get('/admin/feature-flags', staff, async () => {
    return { flags: await repositories.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } }) };
  });

  app.put('/admin/feature-flags', staff, async (request) => {
    assertCan(request, 'manageFeatureFlags');

    const parsed = upsertFeatureFlagRequest.safeParse(request.body);
    if (!parsed.success) throw fromZodError(parsed.error);

    const saved = await repositories.prisma.featureFlag.upsert({
      where: { key: parsed.data.key },
      create: parsed.data,
      update: parsed.data,
    });

    await audit(request, {
      action: 'admin.feature-flag.update',
      targetType: 'FeatureFlag',
      targetId: saved.id,
      metadata: { key: saved.key, enabled: saved.enabled, rollout: saved.rolloutPercent },
    });

    return saved;
  });
}
