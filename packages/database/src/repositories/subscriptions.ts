import {
  ENTITLED_STATUSES,
  planLimits as planLimitsSchema,
  type Payment,
  type Plan,
  type PlanLimits,
  type Subscription,
  type SubscriptionStatus,
} from '@chzzk-bot/contracts';
import type {
  Payment as DbPayment,
  Plan as DbPlan,
  Prisma,
  PrismaClient,
  Subscription as DbSubscription,
} from '../client.js';

type SubscriptionWithPlan = DbSubscription & { plan: DbPlan; billingCard?: { id: string } | null };

/**
 * 구독과 결제 저장소.
 *
 * 상태 전이(체험 → 유료 → 실패 → 만료)의 **규칙**은 여기 없습니다. 그건
 * `@chzzk-bot/billing` 의 몫이고, 이 파일은 읽고 쓰기만 합니다. 둘을 섞으면
 * 결제 정책을 바꿀 때마다 SQL 을 함께 고쳐야 합니다.
 */
export class SubscriptionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ─── 플랜 ──────────────────────────────────────────────────────────────────

  async listPlans(includeHidden = false): Promise<Plan[]> {
    const rows = await this.prisma.plan.findMany({
      where: { active: true, ...(includeHidden ? {} : { isPublic: true }) },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map(toPlan);
  }

  async findPlanByCode(code: string): Promise<Plan | null> {
    const row = await this.prisma.plan.findUnique({ where: { code } });
    return row ? toPlan(row) : null;
  }

  // ─── 구독 ──────────────────────────────────────────────────────────────────

  async findByTenant(tenantId: string): Promise<Subscription | null> {
    const row = await this.prisma.subscription.findUnique({
      where: { tenantId },
      include: { plan: true, billingCard: { select: { id: true } } },
    });
    return row ? toSubscription(row) : null;
  }

  /**
   * 이 채널이 지금 서비스를 쓸 수 있는지 + 어떤 한도인지.
   *
   * 봇 시작·명령 추가·API 호출 등 곳곳에서 부르는 뜨거운 경로라, 구독과 플랜을
   * 한 번의 조인으로 가져옵니다.
   */
  async entitlement(
    tenantId: string
  ): Promise<{ entitled: boolean; status: SubscriptionStatus | null; limits: PlanLimits | null }> {
    const row = await this.prisma.subscription.findUnique({
      where: { tenantId },
      include: { plan: true },
    });
    if (!row) return { entitled: false, status: null, limits: null };

    const entitled =
      ENTITLED_STATUSES.includes(row.status) && row.currentPeriodEnd.getTime() > Date.now();

    return {
      entitled,
      status: row.status,
      limits: planLimitsSchema.parse(row.plan.limits),
    };
  }

  async create(input: {
    tenantId: string;
    planId: string;
    status: SubscriptionStatus;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    trialEndsAt?: Date | null;
    nextBillingAt?: Date | null;
  }): Promise<Subscription> {
    const row = await this.prisma.subscription.create({
      data: {
        tenantId: input.tenantId,
        planId: input.planId,
        status: input.status,
        currentPeriodStart: input.currentPeriodStart,
        currentPeriodEnd: input.currentPeriodEnd,
        trialEndsAt: input.trialEndsAt ?? null,
        nextBillingAt: input.nextBillingAt ?? null,
      },
      include: { plan: true, billingCard: { select: { id: true } } },
    });
    return toSubscription(row);
  }

  async update(tenantId: string, data: Prisma.SubscriptionUpdateInput): Promise<Subscription> {
    const row = await this.prisma.subscription.update({
      where: { tenantId },
      data,
      include: { plan: true, billingCard: { select: { id: true } } },
    });
    return toSubscription(row);
  }

  /** 오늘 결제해야 할 구독들. 정기결제 배치가 씁니다. */
  async dueForBilling(now = new Date(), limit = 100): Promise<SubscriptionWithPlan[]> {
    return this.prisma.subscription.findMany({
      where: {
        status: { in: ['ACTIVE', 'PAST_DUE'] },
        cancelAtPeriodEnd: false,
        nextBillingAt: { lte: now },
        billingCardId: { not: null },
      },
      include: { plan: true, billingCard: { select: { id: true } } },
      take: limit,
    });
  }

  /** 기간이 끝났는데 아직 살아 있는 구독. 만료 배치가 씁니다. */
  async dueForExpiry(now = new Date(), limit = 200): Promise<{ id: string; tenantId: string }[]> {
    return this.prisma.subscription.findMany({
      where: {
        status: { in: ['TRIALING', 'CANCELED', 'PAST_DUE'] },
        currentPeriodEnd: { lt: now },
      },
      select: { id: true, tenantId: true },
      take: limit,
    });
  }

  // ─── 결제 ──────────────────────────────────────────────────────────────────

  async listPayments(tenantId: string, limit = 50): Promise<Payment[]> {
    const rows = await this.prisma.payment.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toPayment);
  }

  async findPayment(paymentId: string): Promise<(Payment & { tenantId: string }) | null> {
    const row = await this.prisma.payment.findUnique({ where: { paymentId } });
    return row ? { ...toPayment(row), tenantId: row.tenantId } : null;
  }

  /**
   * 결제를 기록합니다. 같은 paymentId 가 이미 있으면 갱신만 합니다.
   *
   * PG 웹훅은 같은 사건을 여러 번 보냅니다. upsert 가 아니면 매출이 부풀려집니다.
   */
  async recordPayment(input: {
    tenantId: string;
    subscriptionId?: string | undefined;
    paymentId: string;
    orderName: string;
    amount: number;
    status: Payment['status'];
    method?: string | undefined;
    paidAt?: Date | undefined;
    failureReason?: string | undefined;
    receiptUrl?: string | undefined;
    raw?: unknown;
  }): Promise<Payment> {
    const data = {
      orderName: input.orderName,
      amount: input.amount,
      status: input.status,
      method: input.method ?? null,
      paidAt: input.paidAt ?? null,
      failureReason: input.failureReason ?? null,
      receiptUrl: input.receiptUrl ?? null,
      raw: (input.raw ?? null) as Prisma.InputJsonValue,
    };

    const row = await this.prisma.payment.upsert({
      where: { paymentId: input.paymentId },
      create: {
        tenantId: input.tenantId,
        subscriptionId: input.subscriptionId ?? null,
        paymentId: input.paymentId,
        ...data,
      },
      update: data,
    });
    return toPayment(row);
  }

  async recordRefund(paymentId: string, refundedAmount: number): Promise<Payment> {
    const existing = await this.prisma.payment.findUniqueOrThrow({ where: { paymentId } });
    const total = existing.refundedAmount + refundedAmount;

    const row = await this.prisma.payment.update({
      where: { paymentId },
      data: {
        refundedAmount: total,
        status: total >= existing.amount ? 'REFUNDED' : 'PARTIAL_REFUNDED',
      },
    });
    return toPayment(row);
  }

  // ─── 웹훅 멱등성 ───────────────────────────────────────────────────────────

  /**
   * 이 웹훅을 처음 보는 거라면 true.
   *
   * 유니크 제약 위반을 잡아 "이미 처리함" 으로 판정합니다. 먼저 조회한 뒤
   * 없으면 넣는 방식은 같은 웹훅이 동시에 두 번 도착하면 둘 다 통과합니다.
   */
  async claimWebhook(
    provider: string,
    eventId: string,
    type: string,
    payload: unknown
  ): Promise<boolean> {
    try {
      await this.prisma.webhookEvent.create({
        data: { provider, eventId, type, payload: payload as Prisma.InputJsonValue },
      });
      return true;
    } catch {
      return false;
    }
  }

  async completeWebhook(provider: string, eventId: string, error?: string): Promise<void> {
    await this.prisma.webhookEvent.updateMany({
      where: { provider, eventId },
      data: {
        status: error ? 'FAILED' : 'PROCESSED',
        error: error ?? null,
        processedAt: new Date(),
      },
    });
  }
}

// ─── 매핑 ─────────────────────────────────────────────────────────────────────

function toPlan(row: DbPlan): Plan {
  return {
    id: row.id,
    code: row.code as Plan['code'],
    name: row.name,
    description: row.description,
    priceMonthly: row.priceMonthly,
    currency: 'KRW',
    features: row.features as string[],
    limits: planLimitsSchema.parse(row.limits),
    isPublic: row.isPublic,
    sortOrder: row.sortOrder,
  };
}

function toSubscription(row: SubscriptionWithPlan): Subscription {
  return {
    id: row.id,
    tenantId: row.tenantId,
    plan: toPlan(row.plan),
    status: row.status,
    currentPeriodStart: row.currentPeriodStart.toISOString(),
    currentPeriodEnd: row.currentPeriodEnd.toISOString(),
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    canceledAt: row.canceledAt?.toISOString() ?? null,
    trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
    hasBillingKey: Boolean(row.billingCardId),
  };
}

function toPayment(row: DbPayment): Payment {
  return {
    id: row.id,
    paymentId: row.paymentId,
    orderName: row.orderName,
    amount: row.amount,
    refundedAmount: row.refundedAmount,
    currency: 'KRW',
    status: row.status,
    method: row.method,
    paidAt: row.paidAt?.toISOString() ?? null,
    failureReason: row.failureReason,
    receiptUrl: row.receiptUrl,
    createdAt: row.createdAt.toISOString(),
  };
}
