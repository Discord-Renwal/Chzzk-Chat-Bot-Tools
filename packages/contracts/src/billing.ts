import { z } from 'zod';

/**
 * 요금제 · 구독 · 결제 계약.
 *
 * 금액은 **원(KRW) 정수**로만 다룹니다. 부동소수를 쓰면 10원 단위 할인·부가세
 * 계산에서 반올림 오차가 쌓이고, 그 오차는 결제 대사(reconciliation)에서
 * 반드시 문제로 돌아옵니다.
 */

export const planCode = z.enum(['FREE', 'STARTER', 'PRO', 'PARTNER']);
export type PlanCode = z.infer<typeof planCode>;

/**
 * 플랜별 사용량 상한.
 *
 * `null` 은 무제한입니다. 0 과 헷갈리지 않도록 명시적으로 null 을 씁니다 —
 * 0 을 무제한으로 쓰면 "명령어 0개 플랜" 을 표현할 수 없습니다.
 */
export const planLimits = z.object({
  /** 등록 가능한 커스텀 명령어 수 */
  maxCommands: z.number().int().min(0).nullable(),
  /** 자동응답 규칙 수 */
  maxAutoResponses: z.number().int().min(0).nullable(),
  /** 주기 메시지 수 */
  maxTimers: z.number().int().min(0).nullable(),
  /** 금칙어 수 */
  maxBannedWords: z.number().int().min(0).nullable(),
  /** 봇을 붙일 수 있는 채널 수 */
  maxChannels: z.number().int().min(1),
  /** 이벤트 로그 보관 일수 */
  eventRetentionDays: z.number().int().min(1),
  /** 미니게임 사용 가능 여부 */
  gamesEnabled: z.boolean(),
  /** 신청곡 사용 가능 여부 */
  songRequestsEnabled: z.boolean(),
  /** 외부에서 명령을 실행하는 공개 API 사용 가능 여부 */
  publicApiEnabled: z.boolean(),
  /** 공개 API 분당 호출 상한 */
  apiRateLimitPerMinute: z.number().int().min(0),
});
export type PlanLimits = z.infer<typeof planLimits>;

export const plan = z.object({
  id: z.string(),
  code: planCode,
  name: z.string(),
  description: z.string(),
  /** 월 구독료(원, 부가세 포함) */
  priceMonthly: z.number().int().min(0),
  currency: z.literal('KRW').default('KRW'),
  /** 요금제 카드에 나열할 문구 */
  features: z.array(z.string()),
  limits: planLimits,
  /** 요금제 페이지에 노출할지. 특별 계약 플랜은 숨깁니다. */
  isPublic: z.boolean(),
  sortOrder: z.number().int(),
});
export type Plan = z.infer<typeof plan>;

// ─── 구독 ─────────────────────────────────────────────────────────────────────

export const subscriptionStatus = z.enum([
  /** 무료 체험 중 */
  'TRIALING',
  /** 정상 결제 중 */
  'ACTIVE',
  /** 결제 실패. 유예 기간 동안은 서비스가 유지됩니다. */
  'PAST_DUE',
  /** 해지 예약됨. 기간 끝까지는 ACTIVE 처럼 동작합니다. */
  'CANCELED',
  /** 기간이 끝나 정지됨 */
  'EXPIRED',
]);
export type SubscriptionStatus = z.infer<typeof subscriptionStatus>;

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  TRIALING: '무료 체험',
  ACTIVE: '이용 중',
  PAST_DUE: '결제 실패',
  CANCELED: '해지 예약',
  EXPIRED: '만료됨',
};

/**
 * 봇이 실제로 돌아도 되는 상태들.
 *
 * `CANCELED` 가 포함되는 게 핵심입니다. 해지를 눌러도 이미 낸 기간까지는
 * 쓸 수 있어야 합니다. 기간이 끝나면 배치가 EXPIRED 로 내립니다.
 */
export const ENTITLED_STATUSES: readonly SubscriptionStatus[] = [
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
];

export const subscription = z.object({
  id: z.string(),
  tenantId: z.string(),
  plan,
  status: subscriptionStatus,
  currentPeriodStart: z.string(),
  currentPeriodEnd: z.string(),
  /** 기간 종료와 함께 해지할지 */
  cancelAtPeriodEnd: z.boolean(),
  canceledAt: z.string().nullable(),
  trialEndsAt: z.string().nullable(),
  /** 자동 결제에 쓰는 카드가 등록돼 있는지 */
  hasBillingKey: z.boolean(),
});
export type Subscription = z.infer<typeof subscription>;

// ─── 결제 ─────────────────────────────────────────────────────────────────────

export const paymentStatus = z.enum([
  'READY',
  'PAID',
  'FAILED',
  'CANCELLED',
  'PARTIAL_REFUNDED',
  'REFUNDED',
]);
export type PaymentStatus = z.infer<typeof paymentStatus>;

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  READY: '결제 대기',
  PAID: '결제 완료',
  FAILED: '결제 실패',
  CANCELLED: '취소됨',
  PARTIAL_REFUNDED: '부분 환불',
  REFUNDED: '환불 완료',
};

export const payment = z.object({
  id: z.string(),
  /** PG 사가 부여한 결제 식별자 */
  paymentId: z.string(),
  orderName: z.string(),
  amount: z.number().int(),
  refundedAmount: z.number().int(),
  currency: z.literal('KRW'),
  status: paymentStatus,
  method: z.string().nullable(),
  paidAt: z.string().nullable(),
  failureReason: z.string().nullable(),
  receiptUrl: z.string().nullable(),
  createdAt: z.string(),
});
export type Payment = z.infer<typeof payment>;

export const billingCard = z.object({
  id: z.string(),
  /** "신한카드" 등 */
  issuer: z.string(),
  /** 앞 6 · 뒤 4 만 남긴 마스킹 번호 */
  maskedNumber: z.string(),
  isDefault: z.boolean(),
  createdAt: z.string(),
});
export type BillingCard = z.infer<typeof billingCard>;

// ─── 요청 본문 ────────────────────────────────────────────────────────────────

export const checkoutRequest = z.object({
  planCode,
  /**
   * 브라우저 결제창이 발급한 빌링키 요청 식별자.
   * 서버는 이 값으로 PG 에 조회해 실제 빌링키를 받아옵니다 —
   * 빌링키 자체를 클라이언트에서 받으면 위조를 막을 방법이 없습니다.
   */
  issueId: z.string().min(1),
  /** 결제창을 띄울 때 만든 주문 식별자 */
  billingKeyRequestId: z.string().min(1),
});
export type CheckoutRequest = z.infer<typeof checkoutRequest>;

export const changePlanRequest = z.object({
  planCode,
});
export type ChangePlanRequest = z.infer<typeof changePlanRequest>;

export const cancelSubscriptionRequest = z.object({
  /** 즉시 해지할지, 남은 기간을 다 쓰고 해지할지 */
  immediate: z.boolean().default(false),
  reason: z.string().max(500).default(''),
});
export type CancelSubscriptionRequest = z.infer<typeof cancelSubscriptionRequest>;

export const refundRequest = z.object({
  paymentId: z.string().min(1),
  /** 비우면 전액 환불 */
  amount: z.number().int().positive().optional(),
  reason: z.string().min(1).max(500),
});
export type RefundRequest = z.infer<typeof refundRequest>;
