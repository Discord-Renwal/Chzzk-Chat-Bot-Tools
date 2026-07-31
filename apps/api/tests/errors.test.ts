import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ChzzkApiError } from '@chzzk-bot/chzzk-sdk';
import { ApiException, fromChzzkError, fromZodError } from '../src/errors.js';

/**
 * 오류 변환.
 *
 * 화면이 사용자에게 무엇을 보여줄지가 여기서 결정됩니다. 상태 코드를 뭉개면
 * "서버 오류" 만 뜨고, 사용자는 자기가 무엇을 해야 하는지 알 수 없습니다.
 */
describe('ApiException', () => {
  it('코드에 맞는 기본 상태 코드를 붙인다', () => {
    expect(ApiException.badRequest('x').status).toBe(400);
    expect(ApiException.unauthorized().status).toBe(401);
    expect(ApiException.forbidden().status).toBe(403);
    expect(ApiException.notFound().status).toBe(404);
    expect(ApiException.conflict('x').status).toBe(409);
  });

  it('요금제 한도와 구독 만료는 402 로 내려간다 — 결제 화면으로 안내하기 위해', () => {
    expect(ApiException.planLimit('명령어가 너무 많습니다').status).toBe(402);
    expect(ApiException.subscriptionRequired().status).toBe(402);
  });

  it('기본 메시지는 사용자에게 그대로 보여줄 수 있는 한국어다', () => {
    expect(ApiException.unauthorized().message).toBe('로그인이 필요합니다.');
    expect(ApiException.forbidden().message).toContain('권한');
  });
});

describe('fromZodError', () => {
  it('필드별 메시지를 뽑아낸다', () => {
    const schema = z.object({
      name: z.string().min(1, '이름을 입력하세요.'),
      cooldownSec: z.number().max(3600, '3600초를 넘을 수 없습니다.'),
    });

    const parsed = schema.safeParse({ name: '', cooldownSec: 99_999 });
    expect(parsed.success).toBe(false);

    const error = fromZodError(parsed.error!);
    expect(error.status).toBe(400);
    expect(error.fields).toEqual({
      name: '이름을 입력하세요.',
      cooldownSec: '3600초를 넘을 수 없습니다.',
    });
    expect(error.message).toContain('name:');
  });

  it('중첩된 경로도 점으로 이어 붙인다', () => {
    const schema = z.object({ general: z.object({ prefix: z.string().min(1, '필수입니다.') }) });
    const parsed = schema.safeParse({ general: { prefix: '' } });

    expect(fromZodError(parsed.error!).fields).toEqual({ 'general.prefix': '필수입니다.' });
  });
});

describe('fromChzzkError', () => {
  it('치지직 상태 코드를 그대로 전달한다', () => {
    const error = fromChzzkError(
      new ChzzkApiError({
        code: 400,
        status: 400,
        method: 'GET',
        path: '/open/v1/chats/settings',
        message: '스트리머가 아닙니다.',
      })
    );

    expect(error.status).toBe(400);
    expect(error.code).toBe('UPSTREAM_ERROR');
  });

  it('"[400] GET /path — 사유" 에서 사유만 남긴다', () => {
    const error = fromChzzkError(
      new ChzzkApiError({
        code: 403,
        status: 403,
        method: 'POST',
        path: '/open/v1/chats/send',
        message: '권한이 없습니다.',
      })
    );

    expect(error.message).toBe('권한이 없습니다.');
    expect(error.message).not.toContain('POST');
  });

  it('치지직 오류가 아니면 502 로 감싼다', () => {
    const error = fromChzzkError(new Error('소켓이 끊겼습니다.'));
    expect(error.status).toBe(502);
    expect(error.message).toBe('소켓이 끊겼습니다.');
  });
});
