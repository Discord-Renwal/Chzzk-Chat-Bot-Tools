import { randomUUID } from 'node:crypto';
import type { Plan, PlanCode, Subscription } from '@chzzk-bot/contracts';
import type { Repositories } from '@chzzk-bot/database';
import { decryptSecret, encryptSecret } from '@chzzk-bot/auth';
import { noopLogger, type Logger } from '@chzzk-bot/logger';
import { BILLING_RETRY_DAYS, PAST_DUE_GRACE_DAYS } from '@chzzk-bot/platform-config';
import type { PaymentGateway } from './gateway.js';

export interface SubscriptionServiceOptions {
  repositories: Repositories;
  gateway: PaymentGateway;
  encryptionKey: Buffer;
  logger?: Logger;
}

const DAY_MS = 86_400_000;

/**
 * 구독 수명주기.
 *
 * 상태 전이는 여기 한 곳에만 있습니다. 라우트나 배치가 직접 `status` 를 쓰지
 * 않게 하는 것이 규칙입니다 — 결제 실패 유예, 해지 예약, 체험 종료가 각기 다른
 * 파일에 흩어지면 "왜 이 사람 봇이 멈췄는가" 에 아무도 답할 수 없게 됩니다.
 *
 * ```
 *  TRIALING ──(체험 종료·카드 있음)──▶ ACTIVE ──(결제 실패)──▶ PAST_DUE
 *      │                                 │                        │
 *      │(카드 없음)                       │(해지 신청)              │(3일 유예 후)
 *      ▼                                 ▼                        ▼
 *   EXPIRED  ◀──(기간 종료)──────────  CANCELED ───────────────▶ EXPIRED
 * ```
 */
export class SubscriptionService {
  private readonly log: Logger;

  constructor(private readonly options: SubscriptionServiceOptions) {
    this.log = (options.logger ?? noopLogger).child('billing');
  }

  // ─── 결제 수단 ─────────────────────────────────────────────────────────────

  /**
   * 브라우저에서 발급받은 빌링키를 확정해 저장합니다.
   *
   * 카드 등록만으로는 아무것도 청구하지 않습니다. 등록과 결제를 한 번에 하면
   * "카드만 바꾸려던" 사용자가 예상치 못한 청구를 받습니다.
   */
  async registerCard(
    userId: string,
    issueId: string
  ): Promise<{ cardId: string; issuer: string; maskedNumber: string }> {
    const { repositories, gateway, encryptionKey } = this.options;

    const issued = await gateway.confirmBillingKey(issueId);

    const card = await repositories.prisma.$transaction(async (tx) => {
      // 새로 넣은 카드를 기본으로 삼습니다. 사용자가 카드를 바꾸는 이유는
      // 대부분 "이걸로 결제해 달라" 이기 때문입니다.
      await tx.billingCard.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });

      return tx.billingCard.create({
        data: {
          userId,
          pgProvider: gateway.name,
          billingKeyEnc: encryptSecret(issued.billingKey, encryptionKey),
          issuer: issued.issuer,
          maskedNumber: issued.maskedNumber,
          isDefault: true,
        },
      });
    });

    return { cardId: card.id, issuer: card.issuer, maskedNumber: card.maskedNumber };
  }

  async removeCard(userId: string, cardId: string): Promise<boolean> {
    const { repositories, gateway, encryptionKey } = this.options;

    const card = await repositories.prisma.billingCard.findFirst({
      where: { id: cardId, userId, revokedAt: null },
    });
    if (!card) return false;

    // PG 쪽 폐기가 실패해도 우리 쪽에서는 지웁니다. 사용자가 "삭제했는데 아직
    // 남아 있다" 를 겪는 것보다, PG 에 고아 빌링키가 남는 편이 낫습니다.
    try {
      await gateway.revokeBillingKey(decryptSecret(card.billingKeyEnc, encryptionKey));
    } catch (error) {
      this.log.warn(`빌링키 폐기에 실패했습니다 (card=${cardId}).`, error);
    }

    await repositories.prisma.$transaction([
      repositories.prisma.subscription.updateMany({
        where: { billingCardId: cardId },
        data: { billingCardId: null },
      }),
      repositories.prisma.billingCard.update({
        where: { id: cardId },
        data: { revokedAt: new Date(), isDefault: false },
      }),
    ]);

    return true;
  }

  // ─── 플랜 변경 ─────────────────────────────────────────────────────────────

  /**
   * 플랜을 바꿉니다.
   *
   * 업그레이드는 **즉시** 적용하고 남은 기간만큼만 차액을 받습니다. 방송 직전에
   * 기능이 필요해 결제하는 경우가 대부분인데, "다음 결제일부터 적용" 이면 돈을
   * 내고도 오늘 방송에 못 씁니다.
   *
   * 다운그레이드는 기간이 끝날 때 적용합니다. 이미 받은 돈만큼은 쓸 수 있어야
   * 하고, 즉시 내리면 초과한 명령어를 어떻게 할지 정할 수 없습니다.
   */
  async changePlan(
    tenantId: string,
    planCode: PlanCode
  ): Promise<{ subscription: Subscription; charged: number; scheduled: boolean }> {
    const { repositories } = this.options;

    const [current, nextPlan] = await Promise.all([
      repositories.subscriptions.findByTenant(tenantId),
      repositories.subscriptions.findPlanByCode(planCode),
    ]);

    if (!current) throw new Error('구독 정보를 찾을 수 없습니다.');
    if (!nextPlan) throw new Error(`${planCode} 요금제를 찾을 수 없습니다.`);
    if (current.plan.code === planCode) {
      return { subscription: current, charged: 0, scheduled: false };
    }

    const isUpgrade = nextPlan.priceMonthly > current.plan.priceMonthly;

    if (!isUpgrade) {
      // 다운그레이드 예약. 기간 종료 시 배치가 실제로 갈아끼웁니다.
      const updated = await repositories.subscriptions.update(tenantId, {
        // planId 는 아직 바꾸지 않습니다. 지금 바꾸면 남은 기간의 한도가 즉시 줄어듭니다.
        overrideReason: `${planCode} 로 다운그레이드 예약`,
      });
      await repositories.prisma.subscription.update({
        where: { tenantId },
        data: { cancelAtPeriodEnd: false },
      });
      this.log.info(`${tenantId}: ${current.plan.code} → ${planCode} 다운그레이드 예약`);
      return { subscription: updated, charged: 0, scheduled: true };
    }

    const charged = await this.chargeProration(tenantId, current, nextPlan);

    const updated = await repositories.subscriptions.update(tenantId, {
      plan: { connect: { id: nextPlan.id } },
      status: 'ACTIVE',
      failedAttempts: 0,
      overrideReason: null,
    });

    this.log.info(
      `${tenantId}: ${current.plan.code} → ${planCode} 업그레이드 (차액 ${charged.toLocaleString('ko-KR')}원)`
    );
    return { subscription: updated, charged, scheduled: false };
  }

  /**
   * 남은 기간에 대한 차액을 즉시 청구합니다.
   *
   * 일 단위로 계산하고 원 단위로 **내림**합니다. 올림하면 하루 남기고 업그레이드한
   * 사람에게 1원이라도 더 받게 되는데, 그 1원의 문의 비용이 훨씬 큽니다.
   */
  private async chargeProration(
    tenantId: string,
    current: Subscription,
    nextPlan: Plan
  ): Promise<number> {
    const remainingMs = new Date(current.currentPeriodEnd).getTime() - Date.now();
    if (remainingMs <= 0) return 0;

    const periodMs =
      new Date(current.currentPeriodEnd).getTime() - new Date(current.currentPeriodStart).getTime();
    if (periodMs <= 0) return 0;

    const diff = nextPlan.priceMonthly - current.plan.priceMonthly;
    const amount = Math.floor((diff * remainingMs) / periodMs);
    // 체험 중이거나 1000원 미만 차액은 받지 않습니다. PG 최소 결제 금액에도 걸립니다.
    if (amount < 1000) return 0;

    const result = await this.chargeSubscription(tenantId, amount, `${nextPlan.name} 업그레이드`);
    if (!result.success) {
      throw new Error(result.failureReason ?? '차액 결제에 실패했습니다.');
    }
    return amount;
  }

  // ─── 해지 ──────────────────────────────────────────────────────────────────

  async cancel(
    tenantId: string,
    options: { immediate: boolean; reason: string }
  ): Promise<Subscription> {
    const { repositories } = this.options;
    const now = new Date();

    if (options.immediate) {
      // 즉시 해지는 환불을 동반하지 않습니다. 환불은 별도 승인 절차를 거칩니다.
      const updated = await repositories.subscriptions.update(tenantId, {
        status: 'EXPIRED',
        cancelAtPeriodEnd: false,
        canceledAt: now,
        cancelReason: options.reason,
        currentPeriodEnd: now,
        nextBillingAt: null,
      });
      this.log.info(`${tenantId}: 즉시 해지 — ${options.reason}`);
      return updated;
    }

    const updated = await repositories.subscriptions.update(tenantId, {
      status: 'CANCELED',
      cancelAtPeriodEnd: true,
      canceledAt: now,
      cancelReason: options.reason,
      nextBillingAt: null,
    });
    this.log.info(`${tenantId}: 기간 종료 시 해지 예약 — ${options.reason}`);
    return updated;
  }

  /** 해지 예약을 되돌립니다. */
  async resume(tenantId: string): Promise<Subscription> {
    const { repositories } = this.options;
    const current = await repositories.subscriptions.findByTenant(tenantId);
    if (!current) throw new Error('구독 정보를 찾을 수 없습니다.');
    if (current.status === 'EXPIRED') {
      throw new Error('이미 만료된 구독입니다. 다시 결제해 주세요.');
    }

    return repositories.subscriptions.update(tenantId, {
      status: 'ACTIVE',
      cancelAtPeriodEnd: false,
      canceledAt: null,
      cancelReason: null,
      nextBillingAt: new Date(current.currentPeriodEnd),
    });
  }

  // ─── 정기 결제 ─────────────────────────────────────────────────────────────

  /**
   * 오늘 결제해야 할 구독을 처리합니다. 배치가 하루 한 번 부릅니다.
   *
   * 한 건이 실패해도 나머지를 계속합니다. 카드 한도 초과 하나로 그날 전체
   * 정기결제가 멈추면, 다음 날 두 배로 밀린 채 같은 실패를 다시 만납니다.
   */
  async runBillingCycle(now = new Date()): Promise<{ charged: number; failed: number }> {
    const { repositories } = this.options;
    const due = await repositories.subscriptions.dueForBilling(now);

    let charged = 0;
    let failed = 0;

    for (const subscription of due) {
      try {
        const ok = await this.chargeRenewal(subscription.tenantId, now);
        if (ok) charged += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        this.log.error(`${subscription.tenantId} 정기결제 처리 중 오류`, error);
      }
    }

    if (due.length > 0) {
      this.log.info(`정기결제 ${due.length}건 처리 — 성공 ${charged}, 실패 ${failed}`);
    }
    return { charged, failed };
  }

  private async chargeRenewal(tenantId: string, now: Date): Promise<boolean> {
    const { repositories } = this.options;
    const subscription = await repositories.subscriptions.findByTenant(tenantId);
    if (!subscription) return false;

    const result = await this.chargeSubscription(
      tenantId,
      subscription.plan.priceMonthly,
      `${subscription.plan.name} 정기결제`
    );

    if (result.success) {
      const periodEnd = addMonth(now);
      await repositories.subscriptions.update(tenantId, {
        status: 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        nextBillingAt: periodEnd,
        failedAttempts: 0,
      });
      return true;
    }

    return this.handleChargeFailure(tenantId, now, result.failureReason);
  }

  /**
   * 결제 실패 처리.
   *
   * 바로 끊지 않고 유예 기간을 둡니다. 카드 재발급이나 한도 문제는 며칠이면
   * 풀리는데, 그 사이 방송에서 봇이 사라지면 사용자는 원인도 모른 채 이탈합니다.
   * 유예 동안 하루 한 번씩 세 번 더 시도하고, 그래도 안 되면 만료시킵니다.
   */
  private async handleChargeFailure(
    tenantId: string,
    now: Date,
    reason: string | null
  ): Promise<boolean> {
    const { repositories } = this.options;
    const row = await repositories.prisma.subscription.findUnique({ where: { tenantId } });
    if (!row) return false;

    const attempts = row.failedAttempts + 1;

    if (attempts > BILLING_RETRY_DAYS.length) {
      await repositories.subscriptions.update(tenantId, {
        status: 'EXPIRED',
        failedAttempts: attempts,
        nextBillingAt: null,
      });
      this.log.warn(`${tenantId}: 결제 ${attempts}회 실패로 만료 처리 — ${reason ?? '사유 불명'}`);
      return false;
    }

    const retryInDays = BILLING_RETRY_DAYS[attempts - 1] ?? 1;
    await repositories.subscriptions.update(tenantId, {
      status: 'PAST_DUE',
      failedAttempts: attempts,
      nextBillingAt: new Date(now.getTime() + retryInDays * DAY_MS),
      // 유예 기간 동안은 서비스가 유지되도록 종료일을 밀어 둡니다.
      currentPeriodEnd: new Date(now.getTime() + PAST_DUE_GRACE_DAYS * DAY_MS),
    });

    this.log.warn(`${tenantId}: 결제 실패 ${attempts}회 — ${retryInDays}일 후 재시도`);
    return false;
  }

  /** 저장된 기본 카드로 한 건 청구하고 결제 내역을 남깁니다. */
  private async chargeSubscription(
    tenantId: string,
    amount: number,
    orderName: string
  ): Promise<{ success: boolean; failureReason: string | null }> {
    const { repositories, gateway, encryptionKey } = this.options;

    const row = await repositories.prisma.subscription.findUnique({
      where: { tenantId },
      include: { billingCard: true, tenant: { include: { owner: true } } },
    });

    if (!row?.billingCard || row.billingCard.revokedAt) {
      return { success: false, failureReason: '등록된 결제 수단이 없습니다.' };
    }

    // 우리가 만드는 주문 번호. 같은 값으로 두 번 부르면 PG 가 중복 결제를 막습니다.
    const paymentId = `sub_${tenantId.slice(0, 8)}_${randomUUID().slice(0, 12)}`;

    const result = await gateway.charge({
      billingKey: decryptSecret(row.billingCard.billingKeyEnc, encryptionKey),
      paymentId,
      orderName,
      amount,
      customer: {
        id: row.tenant.ownerId,
        name: row.tenant.owner.channelName,
        ...(row.tenant.owner.email ? { email: row.tenant.owner.email } : {}),
      },
    });

    await repositories.subscriptions.recordPayment({
      tenantId,
      subscriptionId: row.id,
      paymentId: result.paymentId,
      orderName,
      amount,
      status: result.success ? 'PAID' : 'FAILED',
      ...(result.method ? { method: result.method } : {}),
      ...(result.paidAt ? { paidAt: result.paidAt } : {}),
      ...(result.failureReason ? { failureReason: result.failureReason } : {}),
      ...(result.receiptUrl ? { receiptUrl: result.receiptUrl } : {}),
      raw: result.raw,
    });

    return { success: result.success, failureReason: result.failureReason };
  }

  // ─── 만료 배치 ─────────────────────────────────────────────────────────────

  /**
   * 기간이 끝난 구독을 정리합니다.
   *
   * 체험이 끝났는데 카드가 있으면 첫 정기결제를 시도합니다 — 그게 체험의 목적
   * 이니까요. 카드가 없으면 무료 플랜으로 내립니다. 계정을 잠그지 않는 이유는,
   * 며칠 뒤 돌아온 사람이 자기 명령어를 그대로 보고 다시 결제하게 하기 위해서입니다.
   */
  async expireOverdue(now = new Date()): Promise<{ expired: number; renewed: number }> {
    const { repositories } = this.options;
    const overdue = await repositories.subscriptions.dueForExpiry(now);

    let expired = 0;
    let renewed = 0;

    for (const { tenantId } of overdue) {
      const row = await repositories.prisma.subscription.findUnique({
        where: { tenantId },
        include: { billingCard: true },
      });
      if (!row) continue;

      const hasCard = row.billingCard !== null && row.billingCard.revokedAt === null;

      if (row.status === 'TRIALING' && hasCard) {
        const ok = await this.chargeRenewal(tenantId, now);
        if (ok) {
          renewed += 1;
          continue;
        }
      }

      await this.downgradeToFree(tenantId);
      expired += 1;
    }

    if (overdue.length > 0) {
      this.log.info(`만료 처리 ${overdue.length}건 — 갱신 ${renewed}, 만료 ${expired}`);
    }
    return { expired, renewed };
  }

  /** 무료 플랜으로 내립니다. 데이터는 그대로 두고 한도만 좁아집니다. */
  private async downgradeToFree(tenantId: string): Promise<void> {
    const { repositories } = this.options;
    const free = await repositories.subscriptions.findPlanByCode('FREE');
    if (!free) {
      this.log.error(
        'FREE 플랜이 없어 만료 처리를 마치지 못했습니다. `pnpm db:seed` 를 실행하세요.'
      );
      return;
    }

    const farFuture = new Date(Date.now() + 100 * 365 * DAY_MS);
    await repositories.subscriptions.update(tenantId, {
      plan: { connect: { id: free.id } },
      status: 'ACTIVE',
      currentPeriodStart: new Date(),
      // 무료 플랜은 만료 개념이 없습니다. 배치가 다시 집어가지 않도록 멀리 밀어 둡니다.
      currentPeriodEnd: farFuture,
      cancelAtPeriodEnd: false,
      nextBillingAt: null,
      failedAttempts: 0,
    });
  }

  // ─── 환불 ──────────────────────────────────────────────────────────────────

  /** 내부 관리자만 부를 수 있습니다. 권한 검사는 라우트에서 이미 끝난 상태입니다. */
  async refund(
    paymentId: string,
    amount: number | undefined,
    reason: string
  ): Promise<{ success: boolean; refundedAmount: number; failureReason: string | null }> {
    const { repositories, gateway } = this.options;

    const payment = await repositories.subscriptions.findPayment(paymentId);
    if (!payment)
      return { success: false, refundedAmount: 0, failureReason: '결제 내역이 없습니다.' };
    if (payment.status !== 'PAID' && payment.status !== 'PARTIAL_REFUNDED') {
      return {
        success: false,
        refundedAmount: 0,
        failureReason: '환불할 수 있는 상태가 아닙니다.',
      };
    }

    const refundable = payment.amount - payment.refundedAmount;
    if (amount !== undefined && amount > refundable) {
      return {
        success: false,
        refundedAmount: 0,
        failureReason: `환불 가능 금액(${refundable.toLocaleString('ko-KR')}원)을 초과했습니다.`,
      };
    }

    const result = await gateway.refund(paymentId, amount, reason);
    if (!result.success) {
      return { success: false, refundedAmount: 0, failureReason: result.failureReason };
    }

    await repositories.subscriptions.recordRefund(paymentId, result.refundedAmount);
    this.log.info(`환불 ${result.refundedAmount.toLocaleString('ko-KR')}원 — ${paymentId}`);

    return { success: true, refundedAmount: result.refundedAmount, failureReason: null };
  }

  // ─── 웹훅 ──────────────────────────────────────────────────────────────────

  /**
   * PG 가 보낸 상태 변경을 반영합니다.
   *
   * 서명 검증은 호출자(라우트)가 이미 끝냈고, 여기서는 **멱등성**만 책임집니다.
   * 같은 알림이 두 번 오는 것은 오류가 아니라 PG 의 정상 동작입니다.
   */
  async handleWebhook(envelope: {
    eventId: string;
    type: string;
    paymentId: string | null;
    raw: unknown;
  }): Promise<{ processed: boolean; reason?: string }> {
    const { repositories, gateway } = this.options;

    const fresh = await repositories.subscriptions.claimWebhook(
      gateway.name,
      envelope.eventId,
      envelope.type,
      envelope.raw
    );
    if (!fresh) return { processed: false, reason: '이미 처리한 알림입니다.' };

    try {
      if (envelope.paymentId) {
        const payment = await repositories.subscriptions.findPayment(envelope.paymentId);

        // 우리가 만들지 않은 결제 알림입니다. 무시하되 기록은 남깁니다 —
        // 이런 게 쌓이면 storeId 설정이 잘못됐다는 신호입니다.
        if (!payment) {
          await repositories.subscriptions.completeWebhook(
            gateway.name,
            envelope.eventId,
            '알 수 없는 paymentId'
          );
          return { processed: false, reason: '알 수 없는 결제입니다.' };
        }

        if (envelope.type.startsWith('Transaction.Cancelled')) {
          await repositories.subscriptions.recordRefund(
            envelope.paymentId,
            payment.amount - payment.refundedAmount
          );
        }
      }

      await repositories.subscriptions.completeWebhook(gateway.name, envelope.eventId);
      return { processed: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await repositories.subscriptions.completeWebhook(gateway.name, envelope.eventId, message);
      throw error;
    }
  }
}

/**
 * 한 달 뒤.
 *
 * 31일에 결제한 사람의 다음 결제일이 3월 3일이 되지 않도록, 다음 달에 그 날짜가
 * 없으면 그 달의 마지막 날로 맞춥니다. 1월 31일 → 2월 28일 → 3월 28일이 되는
 * 것은 감수합니다. 원래 날짜를 따로 들고 다니는 복잡도보다 낫습니다.
 */
export function addMonth(from: Date): Date {
  const next = new Date(from);
  const day = next.getDate();
  next.setMonth(next.getMonth() + 1);
  if (next.getDate() !== day) next.setDate(0);
  return next;
}
