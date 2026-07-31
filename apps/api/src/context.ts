import { LoginFlow, SessionService, TokenVault, toEncryptionKey } from '@chzzk-bot/auth';
import {
  EntitlementService,
  MockGateway,
  PortOneGateway,
  SubscriptionService,
  type PaymentGateway,
} from '@chzzk-bot/billing';
import { createRepositories, getPrisma, type Repositories } from '@chzzk-bot/database';
import { createLogger, type Logger } from '@chzzk-bot/logger';
import type { ApiEnv } from '@chzzk-bot/platform-config';
import { CoreClient } from './coreClient.js';

/**
 * 앱 전체가 공유하는 의존성 묶음.
 *
 * 라우트가 필요할 때마다 `new XService(...)` 를 하지 않게 하는 게 목적입니다.
 * 그렇게 하면 커넥션 풀이 흩어지고, 테스트에서 갈아끼울 지점이 사라지며,
 * "이 요청이 어떤 PG 를 쓰는가" 같은 질문에 답할 수 없게 됩니다.
 */
export interface AppContext {
  env: ApiEnv;
  logger: Logger;
  repositories: Repositories;
  sessions: SessionService;
  vault: TokenVault;
  login: LoginFlow;
  gateway: PaymentGateway;
  subscriptions: SubscriptionService;
  entitlements: EntitlementService;
  core: CoreClient;
}

export function createContext(env: ApiEnv): AppContext {
  const logger = createLogger(env.LOG_LEVEL, 'api');
  const prisma = getPrisma();
  const repositories = createRepositories(prisma);
  const encryptionKey = toEncryptionKey(env.TOKEN_ENCRYPTION_KEY);

  const oauth = {
    clientId: env.CHZZK_CLIENT_ID,
    clientSecret: env.CHZZK_CLIENT_SECRET,
    redirectUri: env.CHZZK_REDIRECT_URI,
  };

  const sessions = new SessionService(prisma);
  const vault = new TokenVault({ prisma, oauth, encryptionKey, logger });
  const login = new LoginFlow({ oauth, repositories, sessions, vault, logger });

  // 목(mock) PG 는 로컬 개발 전용입니다. 운영에서 켜지면 결제 없이 유료 기능이
  // 열리므로, 프로덕션에서는 아예 쓰지 못하게 막습니다.
  if (env.PORTONE_MOCK && env.NODE_ENV === 'production') {
    throw new Error('PORTONE_MOCK 은 프로덕션에서 사용할 수 없습니다.');
  }

  const gateway: PaymentGateway = env.PORTONE_MOCK
    ? new MockGateway()
    : new PortOneGateway({
        storeId: env.PORTONE_STORE_ID,
        apiSecret: env.PORTONE_API_SECRET,
        channelKey: env.PORTONE_CHANNEL_KEY,
        webhookSecret: env.PORTONE_WEBHOOK_SECRET,
        logger,
      });

  if (env.PORTONE_MOCK) logger.warn('결제가 모의(mock) 모드로 동작합니다. 실제 청구는 없습니다.');

  return {
    env,
    logger,
    repositories,
    sessions,
    vault,
    login,
    gateway,
    subscriptions: new SubscriptionService({ repositories, gateway, encryptionKey, logger }),
    entitlements: new EntitlementService(repositories),
    core: new CoreClient({
      baseUrl: env.CORE_INTERNAL_URL,
      token: env.INTERNAL_API_TOKEN,
      logger,
    }),
  };
}
