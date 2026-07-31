import {
  ChzzkClient,
  FileTokenStore,
  type ChzzkClientOptions,
  type TokenProvider,
} from '@chzzk-bot/chzzk-sdk';
import { createLogger, type Logger } from '@chzzk-bot/logger';
import { loadCliEnv } from '@chzzk-bot/platform-config';

/**
 * 개발자 도구용 클라이언트.
 *
 * `.env` + 로컬 토큰 파일로 동작합니다. 서비스 코드는 절대 이 함수를 쓰지
 * 않습니다 — 운영에서는 테넌트마다 다른 토큰을 DB 금고(`TokenVault`)에서
 * 꺼내 씁니다. 여기 있는 것은 사람이 손으로 돌려 보는 `pnpm login`·`pnpm doctor`
 * 전용이며, 그래서 파일 하나에 묶어 두고 이름으로 구분해 두었습니다.
 */
export function createCliClient(overrides: Partial<ChzzkClientOptions> = {}): {
  chzzk: ChzzkClient;
  tokenStore: FileTokenStore;
  logger: Logger;
} {
  const env = loadCliEnv();
  const logger = overrides.logger ?? createLogger(overrides.logLevel ?? env.LOG_LEVEL);

  const tokenStore = new FileTokenStore(
    {
      clientId: env.CHZZK_CLIENT_ID,
      clientSecret: env.CHZZK_CLIENT_SECRET,
      redirectUri: env.CHZZK_REDIRECT_URI,
    },
    { filePath: env.CHZZK_TOKEN_FILE, logger }
  );

  const tokenProvider: TokenProvider = overrides.tokenProvider ?? tokenStore;

  const chzzk = new ChzzkClient({
    clientId: env.CHZZK_CLIENT_ID,
    clientSecret: env.CHZZK_CLIENT_SECRET,
    ...overrides,
    tokenProvider,
    logger,
  });

  return { chzzk, tokenStore, logger };
}
