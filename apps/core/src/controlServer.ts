import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { executeCommandRequest } from '@chzzk-bot/contracts';
import { noopLogger, type Logger } from '@chzzk-bot/logger';
import { MAX_REQUEST_BODY_BYTES, type CoreEnv } from '@chzzk-bot/platform-config';
import type { BotSupervisor } from './supervisor.js';

export interface ControlServerOptions {
  env: CoreEnv;
  supervisor: BotSupervisor;
  logger?: Logger;
}

/**
 * Core 워커의 내부 제어 API.
 *
 * API 서버만 부릅니다. 브라우저에 노출되지 않으므로 CORS·쿠키·세션이 없고,
 * 공유 비밀 토큰 하나로 인증합니다. 대신 **기본 바인딩이 루프백**이고, 다른
 * 호스트에 열어야 할 때만 CORE_HOST 를 바꾸도록 했습니다 — 이 API 는 남의 봇을
 * 마음대로 조작할 수 있어서 실수로 공개되면 곧바로 사고입니다.
 *
 * 프레임워크를 쓰지 않은 이유는 엔드포인트가 6개뿐이고, 워커 프로세스는 봇에
 * 쓸 메모리를 한 바이트라도 더 남겨두는 편이 낫기 때문입니다.
 */
export function createControlServer(options: ControlServerOptions) {
  const { env, supervisor } = options;
  const log = (options.logger ?? noopLogger).child('control');

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      log.error('요청 처리 중 오류', error);
      sendJson(res, 500, { error: describeError(error) });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${env.CORE_PORT}`);
    const path = url.pathname;
    const method = req.method ?? 'GET';

    // 헬스체크는 인증 없이 엽니다. 로드밸런서와 컨테이너 오케스트레이터가
    // 비밀을 들고 다니게 만들 이유가 없고, 여기서 새는 정보도 없습니다.
    if (path === '/health') {
      return sendJson(res, 200, {
        ok: true,
        workerId: env.CORE_WORKER_ID,
        bots: supervisor.size,
        uptimeSec: Math.floor(process.uptime()),
      });
    }

    if (!authorize(req)) return sendJson(res, 401, { error: '인증에 실패했습니다.' });

    const tenantMatch = /^\/internal\/tenants\/([\w-]+)\/(\w+)$/.exec(path);
    if (tenantMatch && method === 'POST') {
      const tenantId = tenantMatch[1]!;
      const action = tenantMatch[2]!;
      return handleTenantAction(req, res, tenantId, action);
    }

    const stateMatch = /^\/internal\/tenants\/([\w-]+)$/.exec(path);
    if (stateMatch && method === 'GET') {
      const bot = supervisor.get(stateMatch[1]!);
      if (!bot) return sendJson(res, 404, { error: '이 워커가 맡고 있지 않은 채널입니다.' });
      return sendJson(res, 200, bot.state());
    }

    if (path === '/internal/reconcile' && method === 'POST') {
      await supervisor.reconcile();
      return sendJson(res, 200, { ok: true, bots: supervisor.size });
    }

    sendJson(res, 404, { error: `${method} ${path} 은(는) 없는 엔드포인트입니다.` });
  }

  async function handleTenantAction(
    req: IncomingMessage,
    res: ServerResponse,
    tenantId: string,
    action: string
  ): Promise<void> {
    // 시작·재시작은 아직 이 워커가 안 맡고 있어도 받아야 합니다.
    if (action === 'restart' || action === 'start') {
      const started = await supervisor.restart(tenantId);
      return sendJson(res, 200, { ok: started });
    }

    if (action === 'stop') {
      return sendJson(res, 200, { ok: await supervisor.stopTenant(tenantId) });
    }

    const bot = supervisor.get(tenantId);
    if (!bot) return sendJson(res, 404, { error: '이 워커가 맡고 있지 않은 채널입니다.' });

    switch (action) {
      case 'join':
      case 'leave': {
        const body = (await readJson(req)) as { by?: string };
        bot.setJoined(action === 'join', body.by ?? null);
        return sendJson(res, 200, { ok: true, joined: action === 'join' });
      }

      case 'reload': {
        await bot.reloadConfig();
        return sendJson(res, 200, { ok: true });
      }

      // 대시보드 미리보기와 외부 연동이 쓰는 경로입니다.
      // 요청 검증을 여기서 한 번 더 하는 이유는, API 서버를 거치지 않고
      // 내부에서 직접 부르는 배치가 생겨도 계약이 지켜지게 하기 위해서입니다.
      case 'execute': {
        const parsed = executeCommandRequest.safeParse(await readJson(req));
        if (!parsed.success) {
          return sendJson(res, 400, { error: formatIssues(parsed.error.issues) });
        }
        return sendJson(res, 200, await bot.executeCommand(parsed.data));
      }

      default:
        return sendJson(res, 404, { error: `${action} 은(는) 없는 동작입니다.` });
    }
  }

  /**
   * 공유 비밀 검사.
   *
   * 길이가 같을 때만 timingSafeEqual 을 쓰고, 다르면 그대로 거절합니다.
   * 단순 문자열 비교(`===`)는 앞에서부터 다른 지점까지만 비교해 응답 시간에
   * 정보가 새고, 그것만으로 토큰을 한 글자씩 알아낼 수 있습니다.
   */
  function authorize(req: IncomingMessage): boolean {
    const header = req.headers.authorization ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';

    const a = Buffer.from(provided);
    const b = Buffer.from(env.INTERNAL_API_TOKEN);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  return {
    listen: () =>
      new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(env.CORE_PORT, env.CORE_HOST, () => {
          log.info(`제어 API: http://${env.CORE_HOST}:${env.CORE_PORT}`);
          resolve();
        });
      }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_REQUEST_BODY_BYTES) throw new Error('요청 본문이 너무 큽니다.');
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

function formatIssues(issues: { path: (string | number)[]; message: string }[]): string {
  return issues.map((i) => `${i.path.join('.') || '값'}: ${i.message}`).join(', ');
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
