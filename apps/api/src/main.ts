/**
 * API 서버.
 *
 *   pnpm dev:api
 *
 * 사용자 웹(apps/web)과 내부 관리자 콘솔(apps/backoffice)이 유일하게 부르는 곳이며,
 * 봇 제어는 여기서 Core 워커로 넘깁니다.
 */
import { disconnectPrisma } from '@chzzk-bot/database';
import { loadApiEnv } from '@chzzk-bot/platform-config';
import { createContext } from './context.js';
import { startScheduler } from './scheduler.js';
import { buildServer } from './server.js';

const env = loadApiEnv();
const context = createContext(env);
const log = context.logger.child('main');

const app = await buildServer(context);
const scheduler = startScheduler(context);

await app.listen({ port: env.API_PORT, host: env.API_HOST });
log.info(`API: http://${env.API_HOST}:${env.API_PORT}/api`);
log.info(`웹: ${env.WEB_ORIGIN} · 관리자 콘솔: ${env.BACKOFFICE_ORIGIN}`);

let shuttingDown = false;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} 수신 — 종료합니다.`);

    void (async () => {
      // 진행 중인 요청이 끝날 때까지 기다린 뒤 커넥션을 닫습니다.
      // 순서를 바꾸면 마지막 요청이 "DB 연결 없음" 으로 실패합니다.
      await app.close();
      scheduler.stop();
      await disconnectPrisma();
      log.info('정상 종료했습니다.');
      process.exit(0);
    })();
  });
}

process.on('unhandledRejection', (reason) => {
  log.error('처리되지 않은 Promise 거부', reason);
});
