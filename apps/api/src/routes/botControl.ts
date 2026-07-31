import type { FastifyInstance } from 'fastify';
import { executeCommandRequest, type BotStatusResponse } from '@chzzk-bot/contracts';
import type { AppContext } from '../context.js';
import { ApiException, fromZodError } from '../errors.js';
import { currentTenant, currentUser } from '../plugins/authGuard.js';

/**
 * 봇 제어와 명령 실행 API.
 *
 * 요구사항 4번의 바깥쪽 절반입니다 — 안쪽(실제 채팅 처리)은 Core 가 하고,
 * 여기서는 권한·구독·플랜 한도를 확인한 뒤 Core 로 넘깁니다.
 *
 * 검사를 Core 가 아니라 여기서 하는 이유는, Core 는 내부망 전용이라 인증
 * 정보를 모르기 때문입니다. 권한은 사용자 세션을 아는 쪽에서 판단해야 합니다.
 */
export function registerBotControlRoutes(app: FastifyInstance, context: AppContext): void {
  const { repositories, core, entitlements } = context;

  const canView = { preHandler: [app.requireUser, app.requireTenant('VIEWER')] };
  const canControl = { preHandler: [app.requireUser, app.requireTenant('MANAGER')] };

  /**
   * 봇 상태.
   *
   * Core 에 먼저 물어보고, 응답이 없으면 DB 에 남은 마지막 상태를 씁니다.
   * Core 가 잠깐 재시작 중이라고 대시보드가 통째로 오류를 보여줄 이유는 없습니다.
   */
  app.get('/tenants/:tenantId/bot', canView, async (request): Promise<BotStatusResponse> => {
    const tenantId = currentTenant(request).id;

    const [tenant, live, stored] = await Promise.all([
      repositories.tenants.findById(tenantId),
      core.state(tenantId),
      repositories.runtime.get(tenantId),
    ]);

    const instance = live ?? stored;
    return {
      account: tenant
        ? { channelId: tenant.chzzkChannelId, channelName: tenant.channelName }
        : null,
      instance,
      stats: instance?.stats ?? null,
    };
  });

  app.post('/tenants/:tenantId/bot/start', canControl, async (request) => {
    const tenantId = currentTenant(request).id;

    if (!(await entitlements.isEntitled(tenantId))) throw ApiException.subscriptionRequired();

    // 사용자가 스스로 멈춰 둔 채널은 상태가 PAUSED 입니다. Core 의 조정 로직은
    // ACTIVE 만 집어가므로, 켜 달라는 요청에는 이 값을 먼저 되돌려야 합니다.
    await repositories.tenants.updateStatus(tenantId, 'ACTIVE');

    const started = await core.start(tenantId);
    return { ok: started };
  });

  app.post('/tenants/:tenantId/bot/stop', canControl, async (request) => {
    const tenantId = currentTenant(request).id;

    // 상태를 먼저 내립니다. 순서를 바꾸면 Core 의 다음 조정 주기가 이 채널을
    // 다시 살려내, 사용자가 껐는데 1분 뒤 되살아나는 일이 생깁니다.
    await repositories.tenants.updateStatus(tenantId, 'PAUSED');
    await core.stop(tenantId);
    return { ok: true };
  });

  /**
   * 대시보드 버튼으로 입장/퇴장.
   *
   * 채팅에서 `!입장` 을 치는 것과 완전히 같은 동작입니다. 방송 중에 채팅창을
   * 보고 있지 않을 때를 위한 경로입니다.
   */
  app.post<{ Params: { tenantId: string }; Body: { joined?: boolean } }>(
    '/tenants/:tenantId/bot/join',
    canControl,
    async (request) => {
      const tenantId = currentTenant(request).id;
      const user = currentUser(request);
      const joined = request.body?.joined ?? true;

      if (joined && !(await entitlements.isEntitled(tenantId))) {
        throw ApiException.subscriptionRequired();
      }

      await core.setJoined(tenantId, joined, user.channelName);
      return { ok: true, joined };
    }
  );

  /**
   * 명령을 실행해 결과를 바로 돌려줍니다.
   *
   * 요구사항 4번의 "명령어를 API 로 받아서 바로 아웃풋" 이 이것입니다.
   * 대시보드의 미리보기 버튼과 외부 연동(오버레이·디스코드)이 같은 경로를 씁니다.
   *
   * 기본값은 미리보기(broadcast=false, dryRun=true) 입니다. 실제 채팅으로 내보내려면
   * 호출자가 명시적으로 켜야 합니다 — 설정을 시험하다 방송에 문구가 튀어나가면 안 됩니다.
   */
  app.post('/tenants/:tenantId/commands/execute', canControl, async (request) => {
    const tenantId = currentTenant(request).id;

    const parsed = executeCommandRequest.safeParse(request.body);
    if (!parsed.success) throw fromZodError(parsed.error);

    // 실제로 채팅에 내보내는 건 구독이 살아 있을 때만 됩니다.
    // 미리보기는 만료 상태에서도 되어야 다시 결제할지 판단할 수 있습니다.
    if (parsed.data.broadcast && !(await entitlements.isEntitled(tenantId))) {
      throw ApiException.subscriptionRequired();
    }

    return core.executeCommand(tenantId, parsed.data);
  });

  // ─── 실시간 데이터 (시청자 · 신청곡 · 이벤트) ──────────────────────────────

  app.get('/tenants/:tenantId/viewers', canView, async (request) => {
    const tenantId = currentTenant(request).id;
    const [users, total] = await Promise.all([
      repositories.viewers.all(tenantId, 200),
      repositories.viewers.count(tenantId),
    ]);
    return { users, total };
  });

  app.post<{ Params: { tenantId: string; channelId: string }; Body: { delta?: unknown } }>(
    '/tenants/:tenantId/viewers/:channelId/points',
    canControl,
    async (request) => {
      const tenantId = currentTenant(request).id;
      const delta = Number(request.body?.delta);
      if (!Number.isFinite(delta) || delta === 0) {
        throw ApiException.badRequest('delta 는 0 이 아닌 숫자여야 합니다.', {
          delta: '0 이 아닌 숫자',
        });
      }

      const points = await repositories.viewers.adjustPoints(
        tenantId,
        request.params.channelId,
        Math.floor(delta)
      );

      // 봇이 메모리에 들고 있는 값과 어긋나므로 다시 읽게 합니다. 알리지 않으면
      // 방송 중 지급한 포인트가 다음 채팅 한 번에 덮여 사라집니다.
      await core.notifyConfigChanged(tenantId);
      return { channelId: request.params.channelId, points };
    }
  );

  app.post('/tenants/:tenantId/viewers/reset-points', canControl, async (request) => {
    const tenantId = currentTenant(request).id;
    const count = await repositories.viewers.resetAllPoints(tenantId);
    await core.notifyConfigChanged(tenantId);
    return { ok: true, reset: count };
  });

  app.get('/tenants/:tenantId/songs', canView, async (request) => {
    return repositories.runtime.songs(currentTenant(request).id);
  });

  app.get<{ Params: { tenantId: string }; Querystring: { since?: string } }>(
    '/tenants/:tenantId/events',
    canView,
    async (request) => {
      const tenantId = currentTenant(request).id;
      const events = await repositories.runtime.recentEvents(tenantId, 120);
      const since = Number(request.query.since ?? 0);

      return {
        events: Number.isFinite(since) && since > 0 ? events.filter((e) => e.id > since) : events,
        lastId: events.at(-1)?.id ?? 0,
      };
    }
  );
}
