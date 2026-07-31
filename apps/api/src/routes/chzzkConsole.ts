import type { FastifyInstance } from 'fastify';
import { ChzzkClient } from '@chzzk-bot/chzzk-sdk';
import type { AppContext } from '../context.js';
import { ApiException, fromChzzkError } from '../errors.js';
import { currentTenant } from '../plugins/authGuard.js';

/**
 * 치지직 서버 상태를 직접 다루는 화면 — 제재 관리 · 채팅 설정 · 팔로워/구독자.
 *
 * 이 구간은 우리 DB 가 아니라 **치지직이 주인인 값**을 지나보냅니다. 저장하지
 * 않는 이유는 우리가 들고 있는 순간 이미 낡은 값이 되기 때문입니다. 스트리머가
 * 치지직 앱에서 제재를 풀면 우리 DB 는 그 사실을 모릅니다.
 *
 * 스트리머 계정이 아니면 치지직이 400 "스트리머가 아닙니다" 를 줍니다. 그 상태
 * 코드를 그대로 전달해, 화면이 "권한 없음" 과 "서버 오류" 를 구분할 수 있게 합니다.
 */
export function registerChzzkConsoleRoutes(app: FastifyInstance, context: AppContext): void {
  const { repositories, vault, env, core } = context;

  const canView = { preHandler: [app.requireUser, app.requireTenant('VIEWER')] };
  const canModerate = { preHandler: [app.requireUser, app.requireTenant('MANAGER')] };

  /**
   * 이 채널의 주인 자격으로 치지직을 부르는 클라이언트.
   *
   * 요청마다 새로 만듭니다. 캐시하면 채널 수만큼 클라이언트가 메모리에 남고,
   * 토큰이 갱신됐을 때 낡은 인스턴스가 계속 옛 토큰을 쓰게 됩니다. 생성 비용은
   * 객체 몇 개라 무시할 수준입니다 — 실제 비용은 그 뒤의 네트워크 왕복입니다.
   */
  async function chzzkFor(tenantId: string): Promise<ChzzkClient> {
    const tenant = await repositories.tenants.findById(tenantId);
    if (!tenant) throw ApiException.notFound('채널을 찾을 수 없습니다.');

    return new ChzzkClient({
      clientId: env.CHZZK_CLIENT_ID,
      clientSecret: env.CHZZK_CLIENT_SECRET,
      tokenProvider: vault.providerFor(tenant.ownerId),
      logger: context.logger,
    });
  }

  /** 치지직 호출을 감싸 오류를 우리 형식으로 바꿉니다. */
  async function call<T>(tenantId: string, fn: (chzzk: ChzzkClient) => Promise<T>): Promise<T> {
    const chzzk = await chzzkFor(tenantId);
    try {
      return await fn(chzzk);
    } catch (error) {
      throw fromChzzkError(error);
    }
  }

  // ─── 활동 제한 ─────────────────────────────────────────────────────────────

  app.get('/tenants/:tenantId/chzzk/restrictions', canView, async (request) => {
    return call(currentTenant(request).id, async (chzzk) => {
      const page = await chzzk.restrictions.list({ size: 30 });
      return { data: page.data, next: page.page?.next ?? null };
    });
  });

  app.post<{ Params: { tenantId: string }; Body: { targetChannelId?: string } }>(
    '/tenants/:tenantId/chzzk/restrictions',
    canModerate,
    async (request) => {
      const targetChannelId = request.body?.targetChannelId;
      if (!targetChannelId) {
        throw ApiException.badRequest('제한할 채널 ID 가 필요합니다.', {
          targetChannelId: '필수',
        });
      }
      await call(currentTenant(request).id, (chzzk) =>
        chzzk.restrictions.restrict(targetChannelId)
      );
      return { ok: true };
    }
  );

  app.delete<{ Params: { tenantId: string; channelId: string } }>(
    '/tenants/:tenantId/chzzk/restrictions/:channelId',
    canModerate,
    async (request) => {
      await call(currentTenant(request).id, (chzzk) =>
        chzzk.restrictions.unrestrict(request.params.channelId)
      );
      return { ok: true };
    }
  );

  /**
   * 임시 제한 해제.
   *
   * 치지직이 채팅 채널 ID 를 요구하는데, 그 값은 지나가는 채팅 이벤트에만
   * 들어 있습니다. 봇이 주워 둔 값을 Core 에서 받아 씁니다 — 그래서 방송 채팅이
   * 한 번도 오가지 않았다면 이 동작만 할 수 없습니다.
   */
  app.delete<{ Params: { tenantId: string; channelId: string } }>(
    '/tenants/:tenantId/chzzk/temporary-restrictions/:channelId',
    canModerate,
    async (request) => {
      const tenantId = currentTenant(request).id;

      const state = (await core.state(tenantId)) ?? (await repositories.runtime.get(tenantId));
      const chatChannelId = state?.chatChannelId;
      if (!chatChannelId) {
        throw ApiException.conflict(
          '채팅 채널 ID를 아직 모릅니다. 방송 채팅이 한 번 오간 뒤에 시도하세요.'
        );
      }

      await call(tenantId, (chzzk) =>
        chzzk.restrictions.temporaryUnrestrict({
          targetChannelId: request.params.channelId,
          chatChannelId,
        })
      );
      return { ok: true };
    }
  );

  // ─── 채팅 설정 ─────────────────────────────────────────────────────────────

  app.get('/tenants/:tenantId/chzzk/chat-settings', canView, async (request) => {
    return call(currentTenant(request).id, (chzzk) => chzzk.chat.getSettings());
  });

  app.put('/tenants/:tenantId/chzzk/chat-settings', canModerate, async (request) => {
    return call(currentTenant(request).id, async (chzzk) => {
      await chzzk.chat.updateSettings(
        request.body as Parameters<typeof chzzk.chat.updateSettings>[0]
      );
      return chzzk.chat.getSettings();
    });
  });

  // ─── 시청자 · 매니저 ───────────────────────────────────────────────────────

  app.get('/tenants/:tenantId/chzzk/audience', canView, async (request) => {
    return call(currentTenant(request).id, async (chzzk) => {
      // 팔로워와 구독자를 함께 돌려줍니다. 각각 따로 부르면 왕복이 늘어나고,
      // 한쪽이 실패했다고 다른 쪽까지 못 보여줄 이유가 없어 allSettled 를 씁니다.
      const [followers, subscribers] = await Promise.allSettled([
        chzzk.channels.followers({ size: 50 }),
        chzzk.channels.subscribers({ size: 50, sort: 'RECENT' }),
      ]);

      return {
        followers: followers.status === 'fulfilled' ? followers.value : [],
        subscribers: subscribers.status === 'fulfilled' ? subscribers.value : [],
        followersError:
          followers.status === 'rejected' ? fromChzzkError(followers.reason).message : null,
        subscribersError:
          subscribers.status === 'rejected' ? fromChzzkError(subscribers.reason).message : null,
      };
    });
  });

  app.get('/tenants/:tenantId/chzzk/managers', canView, async (request) => {
    return call(currentTenant(request).id, async (chzzk) => ({
      data: await chzzk.channels.streamingRoles(),
    }));
  });

  // ─── 방송 설정 ─────────────────────────────────────────────────────────────

  app.get('/tenants/:tenantId/chzzk/live-setting', canView, async (request) => {
    return call(currentTenant(request).id, (chzzk) => chzzk.lives.getSetting());
  });

  app.patch('/tenants/:tenantId/chzzk/live-setting', canModerate, async (request) => {
    return call(currentTenant(request).id, async (chzzk) => {
      await chzzk.lives.updateSetting(
        request.body as Parameters<typeof chzzk.lives.updateSetting>[0]
      );
      return chzzk.lives.getSetting();
    });
  });

  app.get<{ Params: { tenantId: string }; Querystring: { q?: string } }>(
    '/tenants/:tenantId/chzzk/categories',
    canView,
    async (request) => {
      const query = request.query.q?.trim() ?? '';
      if (!query) return { data: [] };

      return call(currentTenant(request).id, async (chzzk) => ({
        data: await chzzk.categories.search(query, { size: 10 }),
      }));
    }
  );
}
