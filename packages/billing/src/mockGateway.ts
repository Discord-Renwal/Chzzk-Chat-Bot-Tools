import { randomUUID } from 'node:crypto';
import {
  type ChargeRequest,
  type ChargeResult,
  type IssuedBillingKey,
  type PaymentGateway,
  type RefundResult,
  type WebhookEnvelope,
} from './gateway.js';

/**
 * 로컬 개발용 가짜 PG.
 *
 * `PORTONE_MOCK=true` 일 때만 쓰입니다. 실제 결제 없이 구독 흐름 전체를
 * 돌려보기 위한 것이며, **결제 실패도 재현할 수 있어야** 합니다 — 성공만 되는
 * 목으로 개발하면 실패 경로는 운영에서 처음 실행됩니다.
 *
 * 금액 끝자리가 9 이면 실패시킵니다. 규칙을 기억하기 쉽고, 실수로 운영에서
 * 켜져도 정상 금액(4900·12900)은 그대로 흐릅니다.
 */
export class MockGateway implements PaymentGateway {
  readonly name = 'mock';
  private readonly charged = new Map<string, number>();

  confirmBillingKey(issueId: string): Promise<IssuedBillingKey> {
    return Promise.resolve({
      billingKey: `mock_bk_${issueId}`,
      issuer: '모의카드',
      maskedNumber: '1234-56**-****-7890',
    });
  }

  charge(request: ChargeRequest): Promise<ChargeResult> {
    const shouldFail = request.amount % 10 === 9;

    if (shouldFail) {
      return Promise.resolve({
        success: false,
        paymentId: request.paymentId,
        paidAmount: 0,
        method: null,
        paidAt: null,
        receiptUrl: null,
        failureReason: '[모의] 카드 한도를 초과했습니다.',
        raw: { mock: true },
      });
    }

    this.charged.set(request.paymentId, request.amount);
    return Promise.resolve({
      success: true,
      paymentId: request.paymentId,
      paidAmount: request.amount,
      method: 'CARD',
      paidAt: new Date(),
      receiptUrl: `https://example.invalid/receipts/${request.paymentId}`,
      failureReason: null,
      raw: { mock: true },
    });
  }

  refund(paymentId: string, amount: number | undefined, _reason: string): Promise<RefundResult> {
    const paid = this.charged.get(paymentId);
    if (paid === undefined) {
      return Promise.resolve({
        success: false,
        refundedAmount: 0,
        failureReason: '[모의] 결제 내역이 없습니다.',
        raw: null,
      });
    }
    return Promise.resolve({
      success: true,
      refundedAmount: amount ?? paid,
      failureReason: null,
      raw: { mock: true },
    });
  }

  revokeBillingKey(): Promise<void> {
    return Promise.resolve();
  }

  /** 목에서는 서명을 검증할 것이 없습니다. 본문만 그대로 풀어 줍니다. */
  verifyWebhook(rawBody: string): WebhookEnvelope {
    const parsed = JSON.parse(rawBody) as { type?: string; data?: { paymentId?: string } };
    return {
      eventId: randomUUID(),
      type: parsed.type ?? 'mock',
      paymentId: parsed.data?.paymentId ?? null,
      raw: parsed,
    };
  }
}
