import type { FastifyInstance } from 'fastify';
import {
  autoResponse,
  bannedWord,
  botConfig,
  customCommand,
  timerMessage,
} from '@chzzk-bot/contracts';
import { findBuiltin, isGameCommandName, isValidPattern } from '@chzzk-bot/bot-engine';
import type { AppContext } from '../context.js';
import { ApiException, fromZodError } from '../errors.js';
import { currentTenant, currentUser } from '../plugins/authGuard.js';

/** 부분 저장이 가능한 설정 섹션 */
const SECTIONS = [
  'general',
  'permissions',
  'moderation',
  'points',
  'songs',
  'games',
  'notifications',
] as const;
type Section = (typeof SECTIONS)[number];

/**
 * 관리자(스트리머) 대시보드가 쓰는 봇 설정 API.
 *
 * 요구사항 2번 — 마이페이지에서 들어가는 채널 관리 화면이 이 라우트들을 씁니다.
 * 모든 경로가 `/tenants/:tenantId` 아래에 있고, 어느 하나도 tenantId 없이
 * 동작하지 않습니다. 그래야 "채널을 안 넘겨서 남의 데이터가 섞이는" 실수가
 * 구조적으로 불가능해집니다.
 */
export function registerBotConfigRoutes(app: FastifyInstance, context: AppContext): void {
  const { repositories, entitlements, core } = context;

  const canView = { preHandler: [app.requireUser, app.requireTenant('VIEWER')] };
  const canEdit = { preHandler: [app.requireUser, app.requireTenant('MANAGER')] };

  /**
   * 저장 후 Core 에 알립니다.
   *
   * 실패해도 저장 자체는 성공입니다. Core 가 주기적으로 다시 읽으므로 반영이
   * 몇 초 늦을 뿐인데, 여기서 오류를 내면 사용자는 저장이 안 된 줄 알고
   * 같은 작업을 반복합니다.
   */
  const notify = (tenantId: string) => void core.notifyConfigChanged(tenantId);

  // ─── 전체 설정 ─────────────────────────────────────────────────────────────

  app.get('/tenants/:tenantId/config', canView, async (request) => {
    return repositories.botConfig.load(currentTenant(request).id);
  });

  app.put('/tenants/:tenantId/config', canEdit, async (request) => {
    const tenantId = currentTenant(request).id;
    const parsed = botConfig.safeParse(request.body);
    if (!parsed.success) throw fromZodError(parsed.error);

    await repositories.botConfig.saveSettings(tenantId, parsed.data, currentUser(request).id);
    notify(tenantId);
    return repositories.botConfig.load(tenantId);
  });

  app.put<{ Params: { tenantId: string; section: string } }>(
    '/tenants/:tenantId/config/:section',
    canEdit,
    async (request) => {
      const tenantId = currentTenant(request).id;
      const section = request.params.section as Section;
      if (!SECTIONS.includes(section)) {
        throw ApiException.notFound(`${section} 은(는) 없는 설정 섹션입니다.`);
      }

      const draft = await repositories.botConfig.load(tenantId);

      // 금칙어 목록은 별도 엔드포인트로 관리하므로 덮어쓰지 않습니다.
      // 함께 덮으면 다른 탭에서 방금 추가한 금칙어가 조용히 사라집니다.
      const merged =
        section === 'moderation'
          ? { ...draft.moderation, ...(request.body as object), words: draft.moderation.words }
          : { ...draft[section], ...(request.body as object) };

      const parsed = botConfig.safeParse({ ...draft, [section]: merged });
      if (!parsed.success) throw fromZodError(parsed.error);

      await repositories.botConfig.saveSettings(tenantId, parsed.data, currentUser(request).id);
      notify(tenantId);
      return repositories.botConfig.load(tenantId);
    }
  );

  // ─── 명령어 ────────────────────────────────────────────────────────────────

  /**
   * 이름·별칭이 다른 명령과 겹치는지 확인합니다.
   *
   * 내장 명령까지 함께 봐야 합니다. 예전에는 커스텀끼리만 비교해서, `!시간` 이나
   * `!팔로워` 같은 이름을 만들면 저장은 200 으로 성공하는데 실제로는 내장이 먼저
   * 잡아 영영 실행되지 않았습니다.
   */
  async function findNameConflict(
    tenantId: string,
    name: string,
    aliases: string[],
    selfId?: string
  ): Promise<string | null> {
    for (const candidate of [name, ...aliases]) {
      const existing = await repositories.botConfig.findCommandByName(tenantId, candidate);
      if (existing && existing.id !== selfId) {
        return `"${candidate}" 은(는) 이미 다른 명령이 쓰고 있습니다.`;
      }
      // 게임 명령은 내장 목록이 아니라 런타임에서 따로 처리하므로 함께 봅니다.
      if (findBuiltin(candidate) || isGameCommandName(candidate)) {
        return `"${candidate}" 은(는) 내장 명령과 겹칩니다. 다른 이름을 쓰세요.`;
      }
    }
    return null;
  }

  app.post('/tenants/:tenantId/commands', canEdit, async (request, reply) => {
    const tenantId = currentTenant(request).id;

    const allowance = await entitlements.canAdd(tenantId, 'commands');
    if (!allowance.allowed) throw ApiException.planLimit(allowance.message!);

    // id 를 넘기지 않아야 저장소가 새 id 를 발급합니다.
    const parsed = customCommand.omit({ id: true }).safeParse(request.body);
    if (!parsed.success) throw fromZodError(parsed.error);

    const conflict = await findNameConflict(tenantId, parsed.data.name, parsed.data.aliases);
    if (conflict) throw ApiException.conflict(conflict);

    const saved = await repositories.botConfig.upsertCommand(tenantId, parsed.data);
    notify(tenantId);
    return reply.code(201).send(saved);
  });

  app.put<{ Params: { tenantId: string; id: string } }>(
    '/tenants/:tenantId/commands/:id',
    canEdit,
    async (request) => {
      const tenantId = currentTenant(request).id;
      const { id } = request.params;

      const config = await repositories.botConfig.load(tenantId);
      const existing = config.commands.find((c) => c.id === id);
      if (!existing) throw ApiException.notFound('명령어를 찾을 수 없습니다.');

      const parsed = customCommand.safeParse({ ...existing, ...(request.body as object), id });
      if (!parsed.success) throw fromZodError(parsed.error);

      // 생성 때와 같은 검사를 여기서도 해야 합니다. 그러지 않으면 이름을 이미
      // 있는 명령으로 바꿔 저장할 수 있고, 이름 조회는 먼저 찾은 것만 돌려주므로
      // 이 명령이 영영 호출되지 않습니다.
      const conflict = await findNameConflict(tenantId, parsed.data.name, parsed.data.aliases, id);
      if (conflict) throw ApiException.conflict(conflict);

      const saved = await repositories.botConfig.upsertCommand(tenantId, parsed.data);
      notify(tenantId);
      return saved;
    }
  );

  app.delete<{ Params: { tenantId: string; id: string } }>(
    '/tenants/:tenantId/commands/:id',
    canEdit,
    async (request) => {
      const tenantId = currentTenant(request).id;
      const ok = await repositories.botConfig.deleteCommand(tenantId, request.params.id);
      if (!ok) throw ApiException.notFound('없는 명령어입니다.');
      notify(tenantId);
      return { ok: true };
    }
  );

  // ─── 자동응답 ──────────────────────────────────────────────────────────────

  app.post('/tenants/:tenantId/auto-responses', canEdit, async (request, reply) => {
    const tenantId = currentTenant(request).id;

    const allowance = await entitlements.canAdd(tenantId, 'autoResponses');
    if (!allowance.allowed) throw ApiException.planLimit(allowance.message!);

    const parsed = autoResponse.omit({ id: true }).safeParse(request.body);
    if (!parsed.success) throw fromZodError(parsed.error);
    assertValidPattern(parsed.data.pattern, parsed.data.mode);

    const saved = await repositories.botConfig.upsertAutoResponse(tenantId, parsed.data);
    notify(tenantId);
    return reply.code(201).send(saved);
  });

  app.put<{ Params: { tenantId: string; id: string } }>(
    '/tenants/:tenantId/auto-responses/:id',
    canEdit,
    async (request) => {
      const tenantId = currentTenant(request).id;
      const config = await repositories.botConfig.load(tenantId);
      const existing = config.autoResponses.find((a) => a.id === request.params.id);
      if (!existing) throw ApiException.notFound('자동응답을 찾을 수 없습니다.');

      const parsed = autoResponse.safeParse({
        ...existing,
        ...(request.body as object),
        id: request.params.id,
      });
      if (!parsed.success) throw fromZodError(parsed.error);
      assertValidPattern(parsed.data.pattern, parsed.data.mode);

      const saved = await repositories.botConfig.upsertAutoResponse(tenantId, parsed.data);
      notify(tenantId);
      return saved;
    }
  );

  app.delete<{ Params: { tenantId: string; id: string } }>(
    '/tenants/:tenantId/auto-responses/:id',
    canEdit,
    async (request) => {
      const tenantId = currentTenant(request).id;
      const ok = await repositories.botConfig.deleteAutoResponse(tenantId, request.params.id);
      if (!ok) throw ApiException.notFound('없는 항목입니다.');
      notify(tenantId);
      return { ok: true };
    }
  );

  // ─── 금칙어 ────────────────────────────────────────────────────────────────

  app.post('/tenants/:tenantId/banned-words', canEdit, async (request, reply) => {
    const tenantId = currentTenant(request).id;

    const allowance = await entitlements.canAdd(tenantId, 'bannedWords');
    if (!allowance.allowed) throw ApiException.planLimit(allowance.message!);

    const parsed = bannedWord.omit({ id: true }).safeParse(request.body);
    if (!parsed.success) throw fromZodError(parsed.error);
    assertValidPattern(parsed.data.pattern, parsed.data.mode);

    const saved = await repositories.botConfig.upsertBannedWord(tenantId, parsed.data);
    notify(tenantId);
    return reply.code(201).send(saved);
  });

  app.put<{ Params: { tenantId: string; id: string } }>(
    '/tenants/:tenantId/banned-words/:id',
    canEdit,
    async (request) => {
      const tenantId = currentTenant(request).id;
      const config = await repositories.botConfig.load(tenantId);
      const existing = config.moderation.words.find((w) => w.id === request.params.id);
      if (!existing) throw ApiException.notFound('금칙어를 찾을 수 없습니다.');

      const parsed = bannedWord.safeParse({
        ...existing,
        ...(request.body as object),
        id: request.params.id,
      });
      if (!parsed.success) throw fromZodError(parsed.error);
      assertValidPattern(parsed.data.pattern, parsed.data.mode);

      const saved = await repositories.botConfig.upsertBannedWord(tenantId, parsed.data);
      notify(tenantId);
      return saved;
    }
  );

  app.delete<{ Params: { tenantId: string; id: string } }>(
    '/tenants/:tenantId/banned-words/:id',
    canEdit,
    async (request) => {
      const tenantId = currentTenant(request).id;
      const ok = await repositories.botConfig.deleteBannedWord(tenantId, request.params.id);
      if (!ok) throw ApiException.notFound('없는 항목입니다.');
      notify(tenantId);
      return { ok: true };
    }
  );

  // ─── 주기 메시지 ───────────────────────────────────────────────────────────

  app.post('/tenants/:tenantId/timers', canEdit, async (request, reply) => {
    const tenantId = currentTenant(request).id;

    const allowance = await entitlements.canAdd(tenantId, 'timers');
    if (!allowance.allowed) throw ApiException.planLimit(allowance.message!);

    const parsed = timerMessage.omit({ id: true }).safeParse(request.body);
    if (!parsed.success) throw fromZodError(parsed.error);

    const saved = await repositories.botConfig.upsertTimer(tenantId, parsed.data);
    notify(tenantId);
    return reply.code(201).send(saved);
  });

  app.put<{ Params: { tenantId: string; id: string } }>(
    '/tenants/:tenantId/timers/:id',
    canEdit,
    async (request) => {
      const tenantId = currentTenant(request).id;
      const config = await repositories.botConfig.load(tenantId);
      const existing = config.timers.find((t) => t.id === request.params.id);
      if (!existing) throw ApiException.notFound('주기 메시지를 찾을 수 없습니다.');

      const parsed = timerMessage.safeParse({
        ...existing,
        ...(request.body as object),
        id: request.params.id,
      });
      if (!parsed.success) throw fromZodError(parsed.error);

      const saved = await repositories.botConfig.upsertTimer(tenantId, parsed.data);
      notify(tenantId);
      return saved;
    }
  );

  app.delete<{ Params: { tenantId: string; id: string } }>(
    '/tenants/:tenantId/timers/:id',
    canEdit,
    async (request) => {
      const tenantId = currentTenant(request).id;
      const ok = await repositories.botConfig.deleteTimer(tenantId, request.params.id);
      if (!ok) throw ApiException.notFound('없는 항목입니다.');
      notify(tenantId);
      return { ok: true };
    }
  );

  // ─── 사용량 (플랜 한도 표시) ───────────────────────────────────────────────

  app.get('/tenants/:tenantId/usage', canView, async (request) => {
    const tenantId = currentTenant(request).id;
    const [counts, limits] = await Promise.all([
      repositories.botConfig.counts(tenantId),
      entitlements.limits(tenantId),
    ]);
    return { counts, limits };
  });
}

/**
 * 정규식이 실제로 컴파일되는지 확인합니다.
 *
 * 저장 시점에 막지 않으면 깨진 정규식이 채팅 처리 경로에서 매번 예외를 던지고,
 * 그 채널의 봇은 아무 메시지에도 반응하지 않게 됩니다.
 */
function assertValidPattern(pattern: string, mode: string): void {
  if (!isValidPattern(pattern, mode as 'contains' | 'equals' | 'startsWith' | 'regex')) {
    throw ApiException.badRequest('정규식이 올바르지 않습니다.', { pattern: '컴파일 실패' });
  }
}
