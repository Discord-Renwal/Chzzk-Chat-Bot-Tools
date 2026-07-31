import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { AuthenticatedUser } from '@chzzk-bot/auth';
import { staffCan, tenantCan } from '@chzzk-bot/auth';
import type { PlatformRole, TenantRole } from '@chzzk-bot/contracts';
import { isStaff } from '@chzzk-bot/contracts';
import { SESSION_COOKIE } from '@chzzk-bot/platform-config';
import type { AppContext } from '../context.js';
import { ApiException } from '../errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** 로그인한 사용자. `requireUser` 를 거친 라우트에서만 채워집니다. */
    currentUser?: AuthenticatedUser;
    /** 지금 다루고 있는 채널과 그 안에서의 역할. `requireTenant` 가 채웁니다. */
    tenant?: { id: string; role: TenantRole };
  }
}

/**
 * 인증·권한 훅.
 *
 * 훅을 **라우트에 명시적으로 붙이는** 방식을 택했습니다. 전역 훅으로 걸고
 * 예외 경로를 나열하는 방식은, 새 공개 라우트를 추가할 때마다 목록을 고쳐야
 * 하고 빠뜨리면 로그인 화면조차 401 이 됩니다. 반대로 보호 라우트에 붙이는
 * 방식은 빠뜨렸을 때 **열려 버리는** 게 문제인데, 그쪽은 아래 `requireTenant`
 * 처럼 데이터 접근 자체가 테넌트를 요구하도록 만들어 막습니다.
 */
function authGuardPlugin(app: FastifyInstance, options: { context: AppContext }) {
  const { context } = options;

  app.decorateRequest('currentUser', undefined);
  app.decorateRequest('tenant', undefined);

  /** 로그인 필수 */
  app.decorate('requireUser', async (request: FastifyRequest, _reply: FastifyReply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) throw ApiException.unauthorized();

    const user = await context.sessions.verify(token);
    if (!user) throw ApiException.unauthorized('세션이 만료되었습니다. 다시 로그인해 주세요.');

    request.currentUser = user;
  });

  /**
   * 채널 접근 권한 확인.
   *
   * URL 의 `:tenantId` 를 신뢰하지 않고 **매번 멤버십을 조회**합니다. 남의
   * 채널 ID 를 주소창에 넣어 보는 건 가장 먼저 시도되는 공격이고, 여기가
   * 유일한 방어선입니다.
   *
   * 내부 관리자에게 자동으로 열어주지 않는 것도 의도적입니다. 고객 지원을 하려면
   * 전용 엔드포인트(`/admin/*`)를 쓰게 해서, 남의 채널을 들여다본 기록이
   * 감사 로그에 남게 합니다.
   */
  app.decorate(
    'requireTenant',
    (minimumRole: TenantRole = 'VIEWER') =>
      async (request: FastifyRequest, _reply: FastifyReply) => {
        const user = request.currentUser;
        if (!user) throw ApiException.unauthorized();

        const { tenantId } = request.params as { tenantId?: string };
        if (!tenantId) throw ApiException.badRequest('채널이 지정되지 않았습니다.');

        const role = await context.repositories.tenants.roleOf(tenantId, user.id);
        if (!role) throw ApiException.notFound('채널을 찾을 수 없습니다.');

        if (!hasTenantRole(role, minimumRole)) {
          throw ApiException.forbidden('이 채널에서 해당 작업을 수행할 권한이 없습니다.');
        }

        request.tenant = { id: tenantId, role };
      }
  );

  /** 내부 관리자 전용 */
  app.decorate(
    'requireStaff',
    (minimumRole: PlatformRole = 'SUPPORT') =>
      async (request: FastifyRequest, _reply: FastifyReply) => {
        const user = request.currentUser;
        if (!user) throw ApiException.unauthorized();

        // 내부 관리자가 아닌 사람에게는 404 를 줍니다. 403 을 주면 "관리자
        // 콘솔이 여기 있다" 는 사실을 알려주는 셈입니다.
        if (!isStaff(user.platformRole)) throw ApiException.notFound();

        if (!hasPlatformRole(user.platformRole, minimumRole)) {
          throw ApiException.forbidden('상위 관리자 권한이 필요합니다.');
        }
      }
  );

  /**
   * 구독이 살아 있어야 하는 동작.
   *
   * 읽기에는 걸지 않습니다. 구독이 끊겼다고 자기 명령어 목록조차 못 보게 하면,
   * 다시 결제할 이유를 확인할 방법이 없어집니다.
   */
  app.decorate('requireEntitlement', async (request: FastifyRequest, _reply: FastifyReply) => {
    const tenantId = request.tenant?.id;
    if (!tenantId) throw ApiException.badRequest('채널이 지정되지 않았습니다.');

    if (!(await context.entitlements.isEntitled(tenantId))) {
      throw ApiException.subscriptionRequired();
    }
  });
}

const TENANT_RANK: Record<TenantRole, number> = { VIEWER: 0, MANAGER: 1, OWNER: 2 };
const PLATFORM_RANK: Record<PlatformRole, number> = {
  MEMBER: 0,
  SUPPORT: 1,
  OPERATOR: 2,
  SUPER_ADMIN: 3,
};

function hasTenantRole(actual: TenantRole, required: TenantRole): boolean {
  return TENANT_RANK[actual] >= TENANT_RANK[required];
}

function hasPlatformRole(actual: PlatformRole, required: PlatformRole): boolean {
  return PLATFORM_RANK[actual] >= PLATFORM_RANK[required];
}

declare module 'fastify' {
  interface FastifyInstance {
    requireUser: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireTenant: (
      minimumRole?: TenantRole
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireStaff: (
      minimumRole?: PlatformRole
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireEntitlement: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const authGuard = fp(authGuardPlugin, { name: 'auth-guard' });

/** 라우트 안에서 "이 사람이 이걸 해도 되나" 를 물을 때 씁니다. */
export { staffCan, tenantCan };

/** 훅을 통과했으면 반드시 있습니다. 매번 옵셔널 체이닝을 쓰지 않으려고 좁혀 줍니다. */
export function currentUser(request: FastifyRequest): AuthenticatedUser {
  if (!request.currentUser) throw ApiException.unauthorized();
  return request.currentUser;
}

export function currentTenant(request: FastifyRequest): { id: string; role: TenantRole } {
  if (!request.tenant) throw ApiException.badRequest('채널이 지정되지 않았습니다.');
  return request.tenant;
}
