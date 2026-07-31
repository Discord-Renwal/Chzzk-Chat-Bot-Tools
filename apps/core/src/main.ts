/**
 * Core 워커.
 *
 *   pnpm dev:core
 *
 * 하는 일은 세 가지입니다.
 *   ① 구독이 살아 있는 채널마다 치지직 세션을 열고 채팅을 듣습니다.
 *   ② 스트리머·매니저가 `!입장` 을 치면 그 방에서 응답을 시작합니다.
 *   ③ API 서버가 부르는 제어 요청(입장·설정 반영·명령 실행)을 처리합니다.
 */
import { TokenVault, toEncryptionKey } from '@chzzk-bot/auth';
import { createRepositories, disconnectPrisma, getPrisma } from '@chzzk-bot/database';
import { createLogger } from '@chzzk-bot/logger';
import { loadCoreEnv } from '@chzzk-bot/platform-config';
import { createControlServer } from './controlServer.js';
import { BotSupervisor } from './supervisor.js';

const env = loadCoreEnv();
const logger = createLogger(env.LOG_LEVEL, `core:${env.CORE_WORKER_ID}`);
const log = logger.child('main');

const prisma = getPrisma();
const repositories = createRepositories(prisma);

const vault = new TokenVault({
  prisma,
  oauth: {
    clientId: env.CHZZK_CLIENT_ID,
    clientSecret: env.CHZZK_CLIENT_SECRET,
    redirectUri: env.CHZZK_REDIRECT_URI,
  },
  encryptionKey: toEncryptionKey(env.TOKEN_ENCRYPTION_KEY),
  logger,
});

const supervisor = new BotSupervisor({ env, repositories, vault, logger });
const control = createControlServer({ env, supervisor, logger });

// 제어 API 를 **먼저** 띄웁니다. 봇을 다 붙이는 데 수십 초가 걸릴 수 있는데,
// 그동안 헬스체크가 실패하면 오케스트레이터가 아직 정상인 워커를 죽입니다.
await control.listen();

await supervisor.start();
log.info(`봇 ${supervisor.size}개를 맡았습니다.`);

// ─── 종료 처리 ────────────────────────────────────────────────────────────────
//
// 종료 신호를 받으면 저장부터 끝내야 합니다. 그냥 죽으면 마지막 15초 동안 쌓인
// 포인트와 신청곡이 사라지고, 사용자는 "방송 끝나고 포인트가 줄었다" 고 느낍니다.

let shuttingDown = false;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} 수신 — 종료합니다.`);

    // 정리가 끝나기 전에 프로세스가 매달리지 않도록 상한을 둡니다.
    // 20초 안에 못 끝내면 남은 것을 포기하고 나갑니다 — 무한정 매달려 있으면
    // 오케스트레이터가 SIGKILL 로 죽여 어차피 같은 결과가 됩니다.
    const timeout = setTimeout(() => {
      log.error('정리가 20초 안에 끝나지 않아 강제 종료합니다.');
      process.exit(1);
    }, 20_000);
    timeout.unref();

    void (async () => {
      await supervisor.shutdown();
      await control.close();
      await disconnectPrisma();
      clearTimeout(timeout);
      log.info('정상 종료했습니다.');
      process.exit(0);
    })();
  });
}

// 처리하지 못한 오류로 조용히 죽는 것을 막습니다. 워커가 사라지면 그 위의 모든
// 방송에서 봇이 멈추므로, 최소한 이유는 남겨야 합니다.
process.on('unhandledRejection', (reason) => {
  log.error('처리되지 않은 Promise 거부', reason);
});
