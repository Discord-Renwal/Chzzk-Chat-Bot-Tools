import type { FastifyInstance } from 'fastify';
import { toUserProfile } from '@chzzk-bot/database';
import type { SessionUser } from '@chzzk-bot/contracts';
import { OAUTH_STATE_COOKIE, OAUTH_STATE_TTL_MS, SESSION_COOKIE } from '@chzzk-bot/platform-config';
import type { AppContext } from '../context.js';
import { ApiException } from '../errors.js';
import { currentUser } from '../plugins/authGuard.js';

/**
 * 로그인 · 로그아웃 · 내 정보.
 *
 * 흐름은 세 단계입니다.
 *   GET  /auth/login     → 치지직으로 리디렉트 (state 를 쿠키에 심음)
 *   GET  /auth/callback  → 돌아온 code 를 세션으로 교환하고 웹으로 리디렉트
 *   GET  /auth/me        → 프런트가 새로고침할 때마다 부르는 현재 상태
 */
export function registerAuthRoutes(app: FastifyInstance, context: AppContext): void {
  const { env } = context;

  const sessionCookieOptions = {
    httpOnly: true,
    // JS 로 읽을 수 없어야 XSS 로 세션을 훔칠 수 없습니다.
    sameSite: 'lax' as const,
    // 로컬 개발은 http 라서 secure 를 켜면 쿠키가 아예 안 붙습니다.
    secure: env.NODE_ENV === 'production',
    path: '/',
  };

  app.get('/auth/login', (request, reply) => {
    const { url, state } = context.login.begin();

    // state 를 서버 세션이 아니라 쿠키에 두는 이유는, 로그인 전에는 세션이
    // 없기 때문입니다. 쿠키에 심고 콜백에서 대조하면 CSRF 를 막을 수 있습니다.
    void reply.setCookie(OAUTH_STATE_COOKIE, state, {
      ...sessionCookieOptions,
      maxAge: OAUTH_STATE_TTL_MS / 1000,
    });

    // 프런트가 팝업으로 열 수도 있어 리디렉트와 JSON 을 모두 지원합니다.
    if ((request.query as { format?: string }).format === 'json') {
      return reply.send({ url });
    }
    return reply.redirect(url);
  });

  app.get('/auth/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };

    if (query.error) {
      return reply.redirect(`${env.WEB_ORIGIN}/login?error=${encodeURIComponent(query.error)}`);
    }
    if (!query.code || !query.state) {
      return reply.redirect(`${env.WEB_ORIGIN}/login?error=missing_code`);
    }

    const expected = request.cookies[OAUTH_STATE_COOKIE];
    if (!expected || expected !== query.state) {
      // 다른 사이트가 사용자를 이 주소로 유도해 자기 계정으로 로그인시키는
      // 공격(로그인 CSRF)을 막습니다.
      return reply.redirect(`${env.WEB_ORIGIN}/login?error=state_mismatch`);
    }
    void reply.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });

    try {
      const result = await context.login.complete(
        { code: query.code, state: query.state },
        {
          userAgent: request.headers['user-agent'],
          ip: request.ip,
        }
      );

      void reply.setCookie(SESSION_COOKIE, result.sessionToken, {
        ...sessionCookieOptions,
        expires: result.expiresAt,
      });

      // 신규 가입자는 온보딩으로, 기존 사용자는 대시보드로 보냅니다.
      const destination = result.isNewUser ? '/mypage?welcome=1' : '/mypage';
      return reply.redirect(`${env.WEB_ORIGIN}${destination}`);
    } catch (error) {
      context.logger.error('로그인 콜백 처리 실패', error);
      return reply.redirect(`${env.WEB_ORIGIN}/login?error=login_failed`);
    }
  });

  app.post('/auth/logout', { preHandler: app.requireUser }, async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await context.sessions.revoke(token);

    void reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  /** 모든 기기에서 로그아웃 */
  app.post('/auth/logout-all', { preHandler: app.requireUser }, async (request, reply) => {
    const user = currentUser(request);
    const count = await context.sessions.revokeAllForUser(user.id);

    void reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true, revoked: count };
  });

  /**
   * 현재 로그인 상태.
   *
   * 프로필·소속 채널을 한 번에 내려줍니다. 따로 부르면 화면이 여러 단계로
   * 깜빡이고, 어차피 첫 렌더에 전부 필요합니다.
   */
  app.get('/auth/me', { preHandler: app.requireUser }, async (request): Promise<SessionUser> => {
    const authenticated = currentUser(request);

    const user = await context.repositories.users.findById(authenticated.id);
    if (!user) throw ApiException.unauthorized();

    const tenants = await context.repositories.tenants.listForUser(user.id);

    return {
      user: toUserProfile(user),
      tenants,
      activeTenantId: tenants[0]?.id ?? null,
    };
  });
}
