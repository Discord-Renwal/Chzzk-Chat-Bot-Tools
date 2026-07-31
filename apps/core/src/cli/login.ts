/**
 * OAuth 로그인 헬퍼.
 *
 *   pnpm login
 *
 * 로컬 콜백 서버를 띄우고 인가 URL을 출력합니다. 브라우저에서 승인하면
 * 인가 코드를 토큰으로 교환해 `.tokens/chzzk.json` 에 저장합니다.
 */
import { createServer } from 'node:http';
import { loadCliEnv } from '@chzzk-bot/platform-config';
import { createLogger } from '@chzzk-bot/logger';
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  generateState,
  toStoredToken,
} from '@chzzk-bot/chzzk-sdk';
import { createCliClient } from './client.js';

const HTML_OK = `<!doctype html><meta charset="utf-8"><title>인증 완료</title>
<body style="font-family:system-ui;padding:3rem;text-align:center">
<h1>인증이 완료되었습니다</h1><p>터미널로 돌아가세요. 이 창은 닫으셔도 됩니다.</p></body>`;

const HTML_FAIL = (reason: string) => `<!doctype html><meta charset="utf-8"><title>인증 실패</title>
<body style="font-family:system-ui;padding:3rem;text-align:center">
<h1>인증에 실패했습니다</h1><pre>${reason}</pre></body>`;

async function main(): Promise<void> {
  const env = loadCliEnv();
  const log = createLogger(env.LOG_LEVEL, 'login');

  const config = {
    clientId: env.CHZZK_CLIENT_ID,
    clientSecret: env.CHZZK_CLIENT_SECRET,
    redirectUri: env.CHZZK_REDIRECT_URI,
  };

  const expectedState = generateState();
  const { url } = buildAuthorizeUrl(config, { state: expectedState });
  const callbackPath = new URL(config.redirectUri).pathname;

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const requestUrl = new URL(req.url ?? '/', `http://localhost:${env.CHZZK_LOGIN_PORT}`);
      if (requestUrl.pathname !== callbackPath) {
        res.writeHead(404).end('not found');
        return;
      }

      const returnedCode = requestUrl.searchParams.get('code');
      const returnedState = requestUrl.searchParams.get('state');

      const fail = (reason: string) => {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(HTML_FAIL(reason));
        server.close();
        reject(new Error(reason));
      };

      if (!returnedCode) return fail('인가 코드(code)가 없습니다.');
      // state 불일치는 CSRF 신호입니다. 코드를 교환하지 않고 중단합니다.
      if (returnedState !== expectedState) return fail('state 값이 일치하지 않습니다.');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(HTML_OK);
      server.close();
      resolve(returnedCode);
    });

    server.on('error', reject);
    server.listen(env.CHZZK_LOGIN_PORT, () => {
      console.log('\n아래 URL을 브라우저에서 열어 로그인하세요:\n');
      console.log(`  ${url}\n`);
      console.log(`콜백 대기 중 … http://localhost:${env.CHZZK_LOGIN_PORT}${callbackPath}\n`);
    });
  });

  log.info('인가 코드를 토큰으로 교환합니다.');
  const tokenResponse = await exchangeCodeForToken(config, { code, state: expectedState });
  const stored = toStoredToken(tokenResponse);

  const { chzzk, tokenStore: store } = createCliClient({ logger: log });

  // 발급된 토큰이 실제로 동작하는지 확인하고, 채널 정보를 함께 기록해 둡니다.
  try {
    await store.save(stored);
    const me = await chzzk.users.me();
    await store.save({ ...stored, channelId: me.channelId });
    console.log(`\n✅ 인증 완료 — ${me.channelName} (${me.channelId})`);
  } catch (error) {
    console.log('\n✅ 토큰은 저장했지만 /users/me 호출에 실패했습니다.');
    console.log('   개발자센터에서 "유저 정보 조회" 스코프가 켜져 있는지 확인하세요.');
    log.debug('users.me 실패', error);
  }

  console.log(`   저장 위치: ${store.path}\n`);
}

main().catch((error: unknown) => {
  console.error('\n❌ 로그인 실패:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
