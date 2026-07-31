import { getPrisma, type PrismaClient } from '../client.js';
import { AuditRepository } from './audit.js';
import { BotConfigRepository } from './botConfig.js';
import { BotRuntimeRepository } from './runtime.js';
import { SubscriptionRepository } from './subscriptions.js';
import { TenantRepository } from './tenants.js';
import { UserRepository } from './users.js';
import { ViewerRepository } from './viewers.js';

export interface Repositories {
  prisma: PrismaClient;
  users: UserRepository;
  tenants: TenantRepository;
  botConfig: BotConfigRepository;
  viewers: ViewerRepository;
  runtime: BotRuntimeRepository;
  subscriptions: SubscriptionRepository;
  audit: AuditRepository;
}

/**
 * 리포지토리 묶음 하나를 만들어 앱 전체에 넘깁니다.
 *
 * 각 라우트가 필요할 때마다 `new XRepository(getPrisma())` 를 하면, 어디서
 * 무엇을 쓰는지 추적이 안 되고 테스트에서 갈아끼울 지점도 사라집니다.
 */
export function createRepositories(prisma: PrismaClient = getPrisma()): Repositories {
  return {
    prisma,
    users: new UserRepository(prisma),
    tenants: new TenantRepository(prisma),
    botConfig: new BotConfigRepository(prisma),
    viewers: new ViewerRepository(prisma),
    runtime: new BotRuntimeRepository(prisma),
    subscriptions: new SubscriptionRepository(prisma),
    audit: new AuditRepository(prisma),
  };
}
