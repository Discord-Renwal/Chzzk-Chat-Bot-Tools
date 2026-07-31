import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PaymentGatewayError } from '../src/gateway.js';
import { PortOneGateway } from '../src/portone.js';
import { MockGateway } from '../src/mockGateway.js';

/**
 * 웹훅 서명 검증.
 *
 * 위조된 "결제 완료" 알림 하나면 공짜로 유료 플랜을 열 수 있습니다. 그래서
 * 실패 경로 하나하나를 확인합니다 — 여기서 통과시키면 안 되는 것을 통과시키는
 * 순간, 그 사실을 알아챌 방법이 없습니다.
 */

const SECRET = 'whsec_' + Buffer.from('super-secret-key-for-tests-only!').toString('base64');

function makeGateway(): PortOneGateway {
  return new PortOneGateway({
    storeId: 'store-test',
    apiSecret: 'secret',
    channelKey: 'channel',
    webhookSecret: SECRET,
  });
}

/** PortOne 이 보내는 것과 같은 방식으로 서명을 만듭니다. */
function sign(id: string, timestamp: string, body: string): string {
  const key = Buffer.from(SECRET.slice(6), 'base64');
  const digest = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return `v1,${digest}`;
}

function nowSeconds(): string {
  return String(Math.floor(Date.now() / 1000));
}

describe('PortOneGateway.verifyWebhook', () => {
  const body = JSON.stringify({ type: 'Transaction.Paid', data: { paymentId: 'pay_1' } });

  it('서명이 맞으면 내용을 꺼내 준다', () => {
    const id = 'msg_1';
    const timestamp = nowSeconds();

    const envelope = makeGateway().verifyWebhook(body, {
      'webhook-id': id,
      'webhook-timestamp': timestamp,
      'webhook-signature': sign(id, timestamp, body),
    });

    expect(envelope.eventId).toBe('msg_1');
    expect(envelope.type).toBe('Transaction.Paid');
    expect(envelope.paymentId).toBe('pay_1');
  });

  it('헤더가 없으면 거부한다', () => {
    expect(() => makeGateway().verifyWebhook(body, {})).toThrow(PaymentGatewayError);
  });

  it('서명이 다르면 거부한다', () => {
    const id = 'msg_2';
    const timestamp = nowSeconds();

    expect(() =>
      makeGateway().verifyWebhook(body, {
        'webhook-id': id,
        'webhook-timestamp': timestamp,
        'webhook-signature': 'v1,ZmFrZQ==',
      })
    ).toThrow(/서명이 일치하지 않습니다/);
  });

  it('본문이 한 글자라도 바뀌면 거부한다', () => {
    const id = 'msg_3';
    const timestamp = nowSeconds();
    const signature = sign(id, timestamp, body);

    const tampered = JSON.stringify({
      type: 'Transaction.Paid',
      data: { paymentId: 'pay_HACKED' },
    });

    expect(() =>
      makeGateway().verifyWebhook(tampered, {
        'webhook-id': id,
        'webhook-timestamp': timestamp,
        'webhook-signature': signature,
      })
    ).toThrow(/서명이 일치하지 않습니다/);
  });

  it('오래된 타임스탬프는 거부한다 — 재전송 공격 차단', () => {
    const id = 'msg_4';
    // 10분 전. 유효 범위는 5분입니다.
    const timestamp = String(Math.floor(Date.now() / 1000) - 600);

    expect(() =>
      makeGateway().verifyWebhook(body, {
        'webhook-id': id,
        'webhook-timestamp': timestamp,
        'webhook-signature': sign(id, timestamp, body),
      })
    ).toThrow(/타임스탬프/);
  });

  it('키 회전 중 여러 서명이 함께 와도 하나만 맞으면 통과한다', () => {
    const id = 'msg_5';
    const timestamp = nowSeconds();
    const valid = sign(id, timestamp, body);

    const envelope = makeGateway().verifyWebhook(body, {
      'webhook-id': id,
      'webhook-timestamp': timestamp,
      'webhook-signature': `v1,b2xkLXNpZ25hdHVyZQ== ${valid}`,
    });

    expect(envelope.eventId).toBe('msg_5');
  });
});

describe('MockGateway', () => {
  it('결제에 성공하고 금액을 그대로 돌려준다', async () => {
    const result = await new MockGateway().charge({
      billingKey: 'bk',
      paymentId: 'pay_1',
      orderName: '프로 정기결제',
      amount: 12_900,
      customer: { id: 'u1', name: '테스터' },
    });

    expect(result.success).toBe(true);
    expect(result.paidAmount).toBe(12_900);
  });

  it('끝자리가 9 인 금액은 실패시킨다 — 실패 경로를 개발 중에 재현하려고', async () => {
    const result = await new MockGateway().charge({
      billingKey: 'bk',
      paymentId: 'pay_2',
      orderName: '테스트',
      amount: 9,
      customer: { id: 'u1', name: '테스터' },
    });

    expect(result.success).toBe(false);
    expect(result.failureReason).toContain('한도');
  });

  it('결제하지 않은 건은 환불할 수 없다', async () => {
    const result = await new MockGateway().refund('pay_unknown', undefined, '사유');
    expect(result.success).toBe(false);
  });
});
