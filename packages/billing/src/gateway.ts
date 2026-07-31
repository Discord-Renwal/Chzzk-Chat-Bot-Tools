/**
 * 결제 대행사(PG) 어댑터가 지켜야 할 계약.
 *
 * 구독 로직이 PortOne 을 직접 부르지 않고 이 인터페이스만 보게 하는 이유는
 * 두 가지입니다.
 *  - 테스트에서 실제 결제를 일으키지 않고 실패·재시도·환불 경로를 검증할 수 있습니다.
 *  - PG 를 바꾸거나 둘을 병행할 때 갈아끼울 지점이 한 곳으로 모입니다.
 */

export interface IssuedBillingKey {
  billingKey: string;
  /** "신한카드" 처럼 화면에 보여줄 발급사 */
  issuer: string;
  /** 앞 6 · 뒤 4 만 남긴 마스킹 번호 */
  maskedNumber: string;
}

export interface ChargeRequest {
  billingKey: string;
  /** 우리가 만드는 주문 식별자. 같은 값으로 두 번 부르면 PG 가 막아 줍니다. */
  paymentId: string;
  orderName: string;
  amount: number;
  customer: { id: string; name: string; email?: string | undefined };
}

export interface ChargeResult {
  success: boolean;
  paymentId: string;
  /** 실제로 결제된 금액. 실패면 0 */
  paidAmount: number;
  method: string | null;
  paidAt: Date | null;
  receiptUrl: string | null;
  failureReason: string | null;
  /** 대사와 분쟁 대응을 위해 PG 원본 응답을 그대로 보관합니다. */
  raw: unknown;
}

export interface RefundResult {
  success: boolean;
  refundedAmount: number;
  failureReason: string | null;
  raw: unknown;
}

export interface WebhookEnvelope {
  /** 멱등 처리에 쓰는 이 알림의 고유 식별자 */
  eventId: string;
  type: string;
  paymentId: string | null;
  raw: unknown;
}

export interface PaymentGateway {
  readonly name: string;

  /**
   * 브라우저가 만든 빌링키 요청을 실제 빌링키로 바꿉니다.
   *
   * 빌링키를 클라이언트에서 그대로 받지 않는 게 핵심입니다. 받으면 아무나
   * 남의 빌링키를 우리 계정에 붙일 수 있고, 우리는 그것을 구분할 방법이 없습니다.
   */
  confirmBillingKey(issueId: string): Promise<IssuedBillingKey>;

  /** 저장된 빌링키로 결제합니다. */
  charge(request: ChargeRequest): Promise<ChargeResult>;

  /** 부분 환불도 가능합니다. amount 를 비우면 전액. */
  refund(paymentId: string, amount: number | undefined, reason: string): Promise<RefundResult>;

  /** 빌링키를 폐기합니다(카드 삭제·탈퇴). */
  revokeBillingKey(billingKey: string): Promise<void>;

  /**
   * 웹훅 서명을 검증하고 내용을 꺼냅니다.
   *
   * 검증에 실패하면 **던집니다**. 위조된 결제 완료 알림 하나면 공짜로 유료
   * 플랜을 열 수 있으므로, 조용히 무시하는 선택지는 없습니다.
   */
  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): WebhookEnvelope;
}

export class PaymentGatewayError extends Error {
  constructor(
    message: string,
    readonly code: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'PaymentGatewayError';
  }
}
