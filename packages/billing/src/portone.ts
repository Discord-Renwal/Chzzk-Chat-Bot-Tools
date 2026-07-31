import { createHmac, timingSafeEqual } from 'node:crypto';
import { noopLogger, type Logger } from '@chzzk-bot/logger';
import {
  PaymentGatewayError,
  type ChargeRequest,
  type ChargeResult,
  type IssuedBillingKey,
  type PaymentGateway,
  type RefundResult,
  type WebhookEnvelope,
} from './gateway.js';

const API_BASE = 'https://api.portone.io';

export interface PortOneOptions {
  storeId: string;
  /** 콘솔에서 발급한 V2 API Secret */
  apiSecret: string;
  channelKey: string;
  /** 웹훅 서명 검증 키 */
  webhookSecret: string;
  logger?: Logger;
  /** 테스트에서 갈아끼웁니다. */
  fetchImpl?: typeof fetch;
}

/**
 * PortOne(구 아임포트) V2 어댑터.
 *
 * V2 를 쓰는 이유는 빌링키 기반 정기결제가 1급 개념으로 들어가 있고, 웹훅에
 * 표준 서명(webhook-signature)이 붙기 때문입니다. V1 은 서명이 없어 IP 화이트
 * 리스트에 의존해야 합니다.
 *
 * 금액 단위는 원(정수)입니다. PortOne 도 KRW 는 정수로 받습니다.
 */
export class PortOneGateway implements PaymentGateway {
  readonly name = 'portone';
  private readonly log: Logger;
  private readonly http: typeof fetch;

  constructor(private readonly options: PortOneOptions) {
    this.log = (options.logger ?? noopLogger).child('portone');
    this.http = options.fetchImpl ?? fetch;
  }

  async confirmBillingKey(issueId: string): Promise<IssuedBillingKey> {
    const body = await this.request<{
      billingKey: string;
      methods?: { card?: { publisher?: string; issuer?: string; number?: string } }[];
    }>('GET', `/billing-keys/${encodeURIComponent(issueId)}`);

    const card = body.methods?.[0]?.card;
    if (!body.billingKey) {
      throw new PaymentGatewayError('빌링키를 발급받지 못했습니다.', 'BILLING_KEY_MISSING');
    }

    return {
      billingKey: body.billingKey,
      issuer: card?.issuer ?? card?.publisher ?? '카드',
      maskedNumber: card?.number ?? '****-****-****-****',
    };
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    try {
      const body = await this.request<{
        payment?: {
          status?: string;
          amount?: { total?: number };
          method?: { type?: string };
          paidAt?: string;
          receiptUrl?: string;
        };
      }>('POST', `/payments/${encodeURIComponent(request.paymentId)}/billing-key`, {
        billingKey: request.billingKey,
        orderName: request.orderName,
        amount: { total: request.amount },
        currency: 'KRW',
        customer: {
          id: request.customer.id,
          name: { full: request.customer.name },
          ...(request.customer.email ? { email: request.customer.email } : {}),
        },
      });

      const payment = body.payment;
      const paid = payment?.status === 'PAID';

      return {
        success: paid,
        paymentId: request.paymentId,
        paidAmount: paid ? (payment?.amount?.total ?? request.amount) : 0,
        method: payment?.method?.type ?? null,
        paidAt: payment?.paidAt ? new Date(payment.paidAt) : paid ? new Date() : null,
        receiptUrl: payment?.receiptUrl ?? null,
        failureReason: paid ? null : `결제가 완료되지 않았습니다 (상태: ${payment?.status})`,
        raw: body,
      };
    } catch (error) {
      // 결제 실패는 예외가 아니라 **정상적인 결과**입니다. 카드 한도 초과는
      // 늘 일어나는 일이고, 그때마다 배치가 죽으면 뒤에 있는 구독까지 밀립니다.
      const reason = error instanceof Error ? error.message : String(error);
      this.log.warn(`결제 실패 — ${request.paymentId}: ${reason}`);

      return {
        success: false,
        paymentId: request.paymentId,
        paidAmount: 0,
        method: null,
        paidAt: null,
        receiptUrl: null,
        failureReason: reason,
        raw: error instanceof PaymentGatewayError ? { code: error.code, message: reason } : null,
      };
    }
  }

  async refund(
    paymentId: string,
    amount: number | undefined,
    reason: string
  ): Promise<RefundResult> {
    try {
      const body = await this.request<{ cancellation?: { totalAmount?: number } }>(
        'POST',
        `/payments/${encodeURIComponent(paymentId)}/cancel`,
        { reason, ...(amount !== undefined ? { amount } : {}) }
      );

      return {
        success: true,
        refundedAmount: body.cancellation?.totalAmount ?? amount ?? 0,
        failureReason: null,
        raw: body,
      };
    } catch (error) {
      return {
        success: false,
        refundedAmount: 0,
        failureReason: error instanceof Error ? error.message : String(error),
        raw: null,
      };
    }
  }

  async revokeBillingKey(billingKey: string): Promise<void> {
    await this.request('DELETE', `/billing-keys/${encodeURIComponent(billingKey)}`);
  }

  /**
   * 웹훅 서명 검증.
   *
   * PortOne 은 Standard Webhooks 규격을 따릅니다: `webhook-id`, `webhook-timestamp`,
   * `webhook-signature` 를 받아 `id.timestamp.body` 를 HMAC-SHA256 으로 서명합니다.
   *
   * 타임스탬프를 함께 검사하는 이유는 **재전송 공격** 때문입니다. 서명만 맞으면
   * 통과시키면, 예전에 성공했던 결제 알림을 그대로 다시 보내 무한히 기간을
   * 연장할 수 있습니다.
   */
  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): WebhookEnvelope {
    const id = headers['webhook-id'];
    const timestamp = headers['webhook-timestamp'];
    const signature = headers['webhook-signature'];

    if (!id || !timestamp || !signature) {
      throw new PaymentGatewayError('웹훅 서명 헤더가 없습니다.', 'WEBHOOK_HEADERS_MISSING');
    }

    const ageSec = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(ageSec) || ageSec > 300) {
      throw new PaymentGatewayError('웹훅 타임스탬프가 유효 범위를 벗어났습니다.', 'WEBHOOK_STALE');
    }

    const secret = this.options.webhookSecret.startsWith('whsec_')
      ? Buffer.from(this.options.webhookSecret.slice(6), 'base64')
      : Buffer.from(this.options.webhookSecret, 'utf8');

    const expected = createHmac('sha256', secret)
      .update(`${id}.${timestamp}.${rawBody}`)
      .digest('base64');

    // 헤더에는 `v1,<서명>` 이 공백으로 여러 개 올 수 있습니다(키 회전 중).
    const candidates = signature.split(' ').map((part) => part.split(',').pop() ?? '');
    const matched = candidates.some((candidate) => safeEqual(candidate, expected));
    if (!matched) {
      throw new PaymentGatewayError('웹훅 서명이 일치하지 않습니다.', 'WEBHOOK_SIGNATURE_INVALID');
    }

    const parsed = JSON.parse(rawBody) as { type?: string; data?: { paymentId?: string } };
    return {
      eventId: id,
      type: parsed.type ?? 'unknown',
      paymentId: parsed.data?.paymentId ?? null,
      raw: parsed,
    };
  }

  // ─── 내부 ──────────────────────────────────────────────────────────────────

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.http(`${API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `PortOne ${this.options.apiSecret}`,
          'Content-Type': 'application/json',
        },
        ...(body === undefined
          ? {}
          : { body: JSON.stringify({ storeId: this.options.storeId, ...(body as object) }) }),
      });
    } catch (cause) {
      throw new PaymentGatewayError('PortOne 에 연결하지 못했습니다.', 'NETWORK', { cause });
    }

    const text = await response.text();
    const parsed: unknown = text ? safeJsonParse(text) : {};

    if (!response.ok) {
      const detail = parsed as { message?: string; type?: string };
      throw new PaymentGatewayError(
        detail.message ?? `PortOne 오류 (${response.status})`,
        detail.type ?? `HTTP_${response.status}`
      );
    }

    return parsed as T;
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual 은 길이가 다르면 던집니다. 길이 차이는 어차피 불일치입니다.
  return left.length === right.length && timingSafeEqual(left, right);
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}
