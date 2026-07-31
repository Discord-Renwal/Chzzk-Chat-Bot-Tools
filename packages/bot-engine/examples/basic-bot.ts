/**
 * 엔진을 직접 조립하는 최소 봇 예제.
 *
 *   pnpm --filter @chzzk-bot/bot-engine example
 *
 * 실행 전 `pnpm --filter @chzzk-bot/core login` 으로 토큰을 발급받으세요.
 *
 * 이 파일은 **플랫폼을 쓰지 않고** `@chzzk-bot/bot-engine` 과
 * `@chzzk-bot/chzzk-sdk` 만으로 봇을 만드는 방법을 보여줍니다. 서비스 본체
 * (apps/core)는 여기에 멀티테넌시·DB·입장 게이트를 더한 것입니다.
 */
import { ChzzkClient, FileTokenStore } from '@chzzk-bot/chzzk-sdk';
import { createLogger } from '@chzzk-bot/logger';
import { loadCliEnv } from '@chzzk-bot/platform-config';
import { CommandRouter } from '../src/bot/commandRouter.js';
import { ChatSender } from '../src/bot/chatSender.js';

const env = loadCliEnv();
const logger = createLogger(env.LOG_LEVEL, 'example');

const oauth = {
  clientId: env.CHZZK_CLIENT_ID,
  clientSecret: env.CHZZK_CLIENT_SECRET,
  redirectUri: env.CHZZK_REDIRECT_URI,
};

const chzzk = new ChzzkClient({
  ...oauth,
  tokenProvider: new FileTokenStore(oauth, { filePath: env.CHZZK_TOKEN_FILE, logger }),
  logger,
});
const log = chzzk.logger.child('bot');

/** 예제에서는 접두사를 고정합니다. 서비스에서는 채널 설정을 따릅니다. */
const PREFIX = '!';

const me = await chzzk.users.me();
log.info(`${me.channelName} (${me.channelId}) 계정으로 동작합니다.`);

const sender = new ChatSender(chzzk.chat, { logger: chzzk.logger });

const router = new CommandRouter({
  prefix: PREFIX,
  // 봇이 자기 메시지에 반응해 무한 루프를 도는 것을 막습니다.
  botChannelId: me.channelId,
  onError: (error) => log.error('명령 처리 중 오류', error),
});

router
  .register({
    name: '핑',
    aliases: ['ping'],
    description: '봇이 살아 있는지 확인합니다.',
    cooldownMs: 3000,
    handler: async (ctx) => {
      await ctx.reply(`퐁! ${ctx.event.profile.nickname}님 반갑습니다.`);
    },
  })
  .register({
    name: '시간',
    aliases: ['time'],
    description: '현재 시각을 알려 줍니다.',
    cooldownMs: 5000,
    handler: async (ctx) => {
      const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
      await ctx.reply(`현재 시각은 ${now} 입니다.`);
    },
  })
  .register({
    name: '공지',
    description: '공지를 등록합니다. (스트리머/매니저 전용)',
    allowedRoles: ['streamer', 'streaming_channel_manager'],
    handler: async (ctx) => {
      if (!ctx.rest) {
        await ctx.reply('사용법: !공지 <내용>');
        return;
      }
      await chzzk.chat.setNotice({ message: ctx.rest });
      await ctx.reply('공지를 등록했습니다.');
    },
  })
  .register({
    name: '도움말',
    aliases: ['help', '명령어'],
    cooldownMs: 10_000,
    handler: async (ctx) => {
      const names = router.list().map((c) => `${PREFIX}${c.name}`);
      await ctx.reply(`사용 가능한 명령: ${names.join(', ')}`);
    },
  });

const session = chzzk.createSessionClient({
  events: ['CHAT', 'DONATION', 'SUBSCRIPTION'],
  authMode: 'user',
});

session.on('ready', ({ sessionKey }) => {
  log.info(`구독을 시작했습니다. sessionKey=${sessionKey}`);
});

session.on('chat', (event) => {
  log.info(`[채팅] ${event.profile.nickname}: ${event.content}`);
  void router.handle(event, (message) => sender.send(message));
});

session.on('donation', (event) => {
  log.info(`[후원] ${event.donatorNickname} ${event.payAmount}원 — ${event.donationText}`);
  void sender.send(`${event.donatorNickname}님, ${event.payAmount}원 후원 감사합니다!`);
});

session.on('subscription', (event) => {
  log.info(`[구독] ${event.subscriberNickname} 티어${event.tierNo} ${event.month}개월`);
  void sender.send(`${event.subscriberNickname}님, ${event.month}개월 구독 감사합니다!`);
});

session.on('revoked', ({ eventType }) => {
  log.error(`${eventType} 권한이 회수되었습니다. 재인증이 필요합니다.`);
});

session.on('error', (error) => {
  log.error('세션 오류', error);
});

await session.connect();

// Ctrl+C 시 구독을 정리하고 종료합니다.
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} 수신 — 종료합니다.`);
    void session.close().finally(() => process.exit(0));
  });
}
