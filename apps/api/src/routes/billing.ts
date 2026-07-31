import type { FastifyInstance } from 'fastify';
import {
  cancelSubscriptionRequest,
  changePlanRequest,
  checkoutRequest,
  type BillingCard,
} from '@chzzk-bot/contracts';
import type { AppContext } from '../context.js';
import { ApiException, fromZodError } from '../errors.js';
import { currentTenant, currentUser } from '../plugins/authGuard.js';

/**
 * 요금제 · 결제 · 구독 (요구사항 1번의 "결제").
 *
 * 결제 관련 동작은 전부 채널 **주인만** 할 수 있습니다. 매니저는 봇 설정을
 * 바꿀 수 있어도 남의 카드로 플랜을 올릴 수는 없어야 합니다.
 */
export function registerBillingRoutes(app: FastifyInstance, context: AppContext): void {
  const { repositories, subscriptions, gateway, env, core } = context;

  const ownerOnly = { preHandler: [app.requireUser, app.requireTenant('OWNER')] };

  // ─── 공개: 요금제 목록 ─────────────────────────────────────────────────────

  /** 랜딩 페이지의 요금제 섹션이 로그인 없이 부릅니다. */
  app.get('/plans', async () => {
    return { plans: await repositories.subscriptions.listPlans() };
  });

  /** 결제창을 띄우는 데 필요한 값. 시크릿이 아닌 것만 내려줍니다. */
  app.get('/billing/config', { preHandler: app.requireUser }, () => {
    return {
      provider: env.PORTONE_MOCK ? 'mock' : 'portone',
      storeId: env.PORTONE_STORE_ID,
      channelKey: env.PORTONE_CHANNEL_KEY,
    };
  });

  // ─── 구독 상태 ─────────────────────────────────────────────────────────────

  app.get(
    '/tenants/:tenantId/subscription',
    { preHandler: [app.requireUser, app.requireTenant('VIEWER')] },
    async (request) => {
      const tenantId = currentTenant(request).id;
      const subscription = await repositories.subscriptions.findByTenant(tenantId);
      if (!subscription) throw ApiException.notFound('구독 정보를 찾을 수 없습니다.');
      return subscription;
    }
  );

  app.get(
    '/tenants/:tenantId/payments',
    { preHandler: [app.requireUser, app.requireTenant('OWNER')] },
    async (request) => {
      return { payments: await repositories.subscriptions.listPayments(currentTenant(request).id) };
    }
  );

  // ─── 결제 수단 ─────────────────────────────────────────────────────────────

  app.get('/billing/cards', { preHandler: app.requireUser }, async (request) => {
    const user = currentUser(request);
    const rows = await repositories.prisma.billingCard.findMany({
      where: { userId: user.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    const cards: BillingCard[] = rows.map((card) => ({
      id: card.id,
      issuer: card.issuer,
      maskedNumber: card.maskedNumber,
      isDefault: card.isDefault,
      createdAt: card.createdAt.toISOString(),
    }));
    return { cards };
  });

  /**
   * 브라우저가 발급받은 빌링키를 확정합니다.
   *
   * 클라이언트에서 빌링키 원문을 받지 않는 게 핵심입니다. `issueId` 만 받아
   * 우리가 PG 에 다시 물어봐야, 남의 빌링키를 자기 계정에 붙이는 걸 막을 수 있습니다.
   */
  app.post('/billing/cards', { preHandler: app.requireUser }, async (request, reply) => {
    const parsed = checkoutRequest.pick({ issueId: true }).safeParse(request.body);
    if (!parsed.success) throw fromZodError(parsed.error);

    const user = currentUser(request);
    const card = await subscriptions.registerCard(user.id, parsed.data.issueId);

    await repositories.audit.record({
      actorType: 'USER',
      actorId: user.id,
      actorName: user.channelName,
      action: 'billing.card.register',
      targetType: 'BillingCard',
      targetId: card.cardId,
      ip: request.ip,
    });

    return reply.code(201).send(card);
  });

  app.delete<{ Params: { cardId: string } }>(
    '/billing/cards/:cardId',
    { preHandler: app.requireUser },
    async (request) => {
      const user = currentUser(request);
      const removed = await subscriptions.removeCard(user.id, request.params.cardId);
      if (!removed) throw ApiException.notFound('결제 수단을 찾을 수 없습니다.');

      await repositories.audit.record({
        actorType: 'USER',
        actorId: user.id,
        actorName: user.channelName,
        action: 'billing.card.remove',
        targetType: 'BillingCard',
        targetId: request.params.cardId,
        ip: request.ip,
      });

      return { ok: true };
    }
  );

  // ─── 플랜 변경 ─────────────────────────────────────────────────────────────

  /**
   * 결제 시작 — 카드 등록과 플랜 적용을 한 번에.
   *
   * 두 단계를 나누면 카드만 등록하고 플랜은 그대로인 어정쩡한 상태가 남고,
   * 사용자는 "결제했는데 왜 안 되냐" 고 묻게 됩니다.
   */
  app.post('/tenants/:tenantId/subscription/checkout', ownerOnly, async (request) => {
    const parsed = checkoutRequest.safeParse(request.body);
    if (!parsed.success) throw fromZodError(parsed.error);

    const tenantId = currentTenant(request).id;
    const user = currentUser(request);

    const card = await subscriptions.registerCard(user.id, parsed.data.issueId);

    // 방금 등록한 카드를 이 구독에 붙입니다. 붙이지 않으면 정기결제 배치가
    // "결제 수단 없음" 으로 건너뜁니다.
    await repositories.prisma.subscription.update({
      where: { tenantId },
      data: { billingCardId: card.cardId },
    });

    const result = await subscriptions.changePlan(tenantId, parsed.data.planCode);

    await repositories.audit.record({
      actorType: 'USER',
      actorId: user.id,
      actorName: user.channelName,
      action: 'subscription.checkout',
      targetType: 'Tenant',
      targetId: tenantId,
      tenantId,
      metadata: { planCode: parsed.data.planCode, charged: result.charged },
      ip: request.ip,
    });

    // 플랜이 올라가면 새 한도가 곧바로 필요합니다.
    await core.notifyConfigChanged(tenantId);
    return result;
  });

  app.post('/tenants/:tenantId/subscription/plan', ownerOnly, async (request) => {
    const parsed = changePlanRequest.safeParse(request.body);
    if (!parsed.success) throw fromZodError(parsed.error);

    const tenantId = currentTenant(request).id;
    const user = currentUser(request);

    try {
      const result = await subscriptions.changePlan(tenantId, parsed.data.planCode);

      await repositories.audit.record({
        actorType: 'USER',
        actorId: user.id,
        actorName: user.channelName,
        action: result.scheduled ? 'subscription.downgrade' : 'subscription.upgrade',
        targetType: 'Tenant',
        targetId: tenantId,
        tenantId,
        metadata: { planCode: parsed.data.planCode, charged: result.charged },
        ip: request.ip,
      });

      await core.notifyConfigChanged(tenantId);
      return result;
    } catch (error) {
      // 결제 실패는 사용자가 고칠 수 있는 문제(카드 한도·유효기간)라
      // 500 이 아니라 402 로 내려 화면이 결제 수단 변경을 안내하게 합니다.
      throw new ApiException(
        'PLAN_LIMIT_EXCEEDED',
        error instanceof Error ? error.message : '플랜 변경에 실패했습니다.'
      );
    }
  });

  app.post('/tenants/:tenantId/subscription/cancel', ownerOnly, async (request) => {
    const parsed = cancelSubscriptionRequest.safeParse(request.body ?? {});
    if (!parsed.success) throw fromZodError(parsed.error);

    const tenantId = currentTenant(request).id;
    const user = currentUser(request);

    const subscription = await subscriptions.cancel(tenantId, {
      immediate: parsed.data.immediate,
      reason: parsed.data.reason,
    });

    await repositories.audit.record({
      actorType: 'USER',
      actorId: user.id,
      actorName: user.channelName,
      action: 'subscription.cancel',
      targetType: 'Tenant',
      targetId: tenantId,
      tenantId,
      reason: parsed.data.reason,
      metadata: { immediate: parsed.data.immediate },
      ip: request.ip,
    });

    return subscription;
  });

  app.post('/tenants/:tenantId/subscription/resume', ownerOnly, async (request) => {
    const tenantId = currentTenant(request).id;
    const user = currentUser(request);

    const subscription = await subscriptions.resume(tenantId);

    await repositories.audit.record({
      actorType: 'USER',
      actorId: user.id,
      actorName: user.channelName,
      action: 'subscription.resume',
      targetType: 'Tenant',
      targetId: tenantId,
      tenantId,
      ip: request.ip,
    });

    return subscription;
  });

  // ─── 웹훅 ──────────────────────────────────────────────────────────────────

  /**
   * PG 가 보내는 상태 변경 알림.
   *
   * 인증이 없는 대신 **서명**으로 신뢰합니다. 서명 검증에는 원본 바이트가 그대로
   * 필요해서, 이 라우트만 JSON 파싱을 끄고 문자열로 받습니다 — 한 번 파싱했다가
   * 다시 직렬화하면 키 순서나 공백이 달라져 서명이 깨집니다.
   *
   * 실패해도 **200 을 돌려주는 경우**가 있습니다. 우리 쪽 처리 오류로 4xx/5xx 를
   * 주면 PG 가 며칠간 같은 알림을 재전송하는데, 이미 기록은 남겼으므로 재전송이
   * 도움이 되지 않습니다. 반대로 서명 실패는 401 을 줘야 합니다.
   */
  app.post('/webhooks/portone', async (request, reply) => {
    // 파서가 보관해 둔 원본 문자열입니다 (`plugins/rawBody.ts`).
    const raw = request.rawBody ?? JSON.stringify(request.body ?? {});

    let envelope;
    try {
      envelope = gateway.verifyWebhook(raw, request.headers as Record<string, string>);
    } catch (error) {
      context.logger.warn('웹훅 서명 검증 실패', error);
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: '서명 불일치' } });
    }

    try {
      const result = await subscriptions.handleWebhook(envelope);
      return reply.code(200).send(result);
    } catch (error) {
      context.logger.error('웹훅 처리 실패', error);
      // 이미 WebhookEvent 에 FAILED 로 남았습니다. 사람이 보고 재처리합니다.
      return reply.code(200).send({ processed: false, reason: 'internal' });
    }
  });
}
