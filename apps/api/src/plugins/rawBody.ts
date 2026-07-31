import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { MAX_REQUEST_BODY_BYTES } from '@chzzk-bot/platform-config';

declare module 'fastify' {
  interface FastifyRequest {
    /** 파싱 전의 본문 문자열. 웹훅 서명 검증에만 씁니다. */
    rawBody?: string;
  }
}

/**
 * JSON 본문을 파싱하면서 **원본 문자열도 함께** 보관합니다.
 *
 * PG 웹훅 서명은 우리가 받은 바이트 그대로를 대상으로 계산됩니다. 파싱한 객체를
 * 다시 `JSON.stringify` 하면 키 순서·공백·유니코드 이스케이프가 달라져 서명이
 * 깨집니다. 그래서 파싱 시점에 원본을 붙들어 둡니다.
 *
 * 모든 요청에 대해 문자열을 하나 더 들고 있게 되지만, 본문 상한이 1MB 라
 * 메모리 영향은 없습니다. 웹훅 경로만 따로 파서를 다는 방법도 있는데, Fastify 는
 * 콘텐츠 타입 단위로만 파서를 등록할 수 있어 경로별 분리가 깔끔하지 않습니다.
 */
function rawBodyPlugin(app: FastifyInstance) {
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string', bodyLimit: MAX_REQUEST_BODY_BYTES },
    (request, body, done) => {
      const raw = body as string;
      request.rawBody = raw;

      if (!raw) {
        done(null, {});
        return;
      }

      try {
        done(null, JSON.parse(raw));
      } catch (error) {
        const failure = error as Error & { statusCode?: number };
        failure.statusCode = 400;
        done(failure, undefined);
      }
    }
  );
}

export const rawBody = fp(rawBodyPlugin, { name: 'raw-body' });
