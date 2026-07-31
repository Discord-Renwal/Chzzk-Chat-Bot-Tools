import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { ERROR_STATUS } from '@chzzk-bot/contracts';
import { createRequestLogger } from '@chzzk-bot/logger';
import { MAX_REQUEST_BODY_BYTES } from '@chzzk-bot/platform-config';
import type { AppContext } from './context.js';
import { ApiException } from './errors.js';
import { authGuard } from './plugins/authGuard.js';
import { rawBody } from './plugins/rawBody.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerBillingRoutes } from './routes/billing.js';
import { registerBotConfigRoutes } from './routes/botConfig.js';
import { registerBotControlRoutes } from './routes/botControl.js';
import { registerChzzkConsoleRoutes } from './routes/chzzkConsole.js';
import { registerSystemRoutes } from './routes/system.js';

/**
 * API 서버 조립.
 *
 * 모든 라우트가 `/api` 아래에 있습니다. 프런트는 개발 중 Vite 프록시로, 배포
 * 에서는 같은 도메인의 경로로 접근하므로 CORS 없이 쿠키가 그대로 붙습니다.
 * (다른 도메인에 올릴 때를 대비해 CORS 도 열어 두되 오리진을 명시합니다.)
 */
export async function buildServer(context: AppContext): Promise<FastifyInstance> {
  const { env, logger } = context;
  const logRequest = createRequestLogger(logger);

  const app = Fastify({
    // Fastify 기본 로거 대신 우리 로거를 씁니다. 두 개를 함께 쓰면 같은 요청이
    // 형식이 다른 두 줄로 남아 로그 파이프라인에서 골칫거리가 됩니다.
    logger: false,
    bodyLimit: MAX_REQUEST_BODY_BYTES,
    // 프록시 뒤에 있을 때 request.ip 가 실제 클라이언트 주소가 되도록.
    // 감사 로그와 레이트 리밋이 이 값을 씁니다.
    trustProxy: true,
    genReqId: () => randomUUID(),
  });

  await app.register(rawBody);
  await app.register(cookie, { secret: env.SESSION_SECRET });

  await app.register(cors, {
    origin: [env.WEB_ORIGIN, env.BACKOFFICE_ORIGIN],
    // 세션 쿠키가 오가야 하므로 필수입니다.
    credentials: true,
  });

  /**
   * 레이트 리밋.
   *
   * 로그인하지 않은 요청은 IP 로, 로그인한 요청은 사용자 단위로 셉니다. IP 만
   * 쓰면 같은 회사·학교에서 접속한 사용자들이 서로의 몫을 잡아먹습니다.
   */
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.currentUser?.id ?? request.ip,
    // 웹훅은 PG 가 재전송을 몰아서 보낼 수 있어 제외합니다. 서명으로 이미 걸러집니다.
    allowList: (request) => request.url.startsWith('/api/webhooks/'),
    errorResponseBuilder: () => ({
      error: { code: 'RATE_LIMITED', message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
    }),
  });

  await app.register(authGuard, { context });

  // ─── 오류 처리 ─────────────────────────────────────────────────────────────

  /**
   * 모든 오류가 같은 모양으로 나가게 합니다.
   *
   * 5xx 는 내부 메시지를 **숨깁니다**. 스택 트레이스나 DB 오류 문구가 그대로
   * 나가면 스키마 구조가 노출되고, 사용자에게도 아무 도움이 안 됩니다.
   */
  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;

    if (error instanceof ApiException) {
      return reply.code(error.status).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.fields ? { fields: error.fields } : {}),
          requestId,
        },
      });
    }

    // Fastify 자체 검증 실패(본문 크기·JSON 파싱 등)
    const failure = error as { statusCode?: number; message?: string };
    const status = failure.statusCode ?? 500;
    if (status < 500) {
      return reply.code(status).send({
        error: { code: 'BAD_REQUEST', message: failure.message ?? '잘못된 요청입니다.', requestId },
      });
    }

    logger.error(`처리되지 않은 오류 (${requestId})`, error);
    return reply.code(500).send({
      error: {
        code: 'INTERNAL',
        message: '서버에서 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
        requestId,
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.code(ERROR_STATUS.NOT_FOUND).send({
      error: {
        code: 'NOT_FOUND',
        message: `${request.method} ${request.url} 은(는) 없는 엔드포인트입니다.`,
        requestId: request.id,
      },
    });
  });

  app.addHook('onResponse', (request, reply, done) => {
    logRequest({
      method: request.method,
      path: request.url,
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
      requestId: request.id,
      userId: request.currentUser?.id,
      tenantId: request.tenant?.id,
    });
    done();
  });

  // ─── 라우트 ────────────────────────────────────────────────────────────────

  app.get('/api/health', async () => {
    const core = await context.core.health();
    return {
      ok: true,
      version: process.env.npm_package_version ?? '1.0.0',
      core: core ? { ok: true, bots: core.bots } : { ok: false },
    };
  });

  await app.register(
    (scope) => {
      registerAuthRoutes(scope, context);
      registerBillingRoutes(scope, context);
      registerBotConfigRoutes(scope, context);
      registerBotControlRoutes(scope, context);
      registerChzzkConsoleRoutes(scope, context);
      registerAdminRoutes(scope, context);
      registerSystemRoutes(scope);
    },
    { prefix: '/api' }
  );

  return app;
}
