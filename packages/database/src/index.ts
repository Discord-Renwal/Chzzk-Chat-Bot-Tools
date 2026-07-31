/**
 * 데이터 접근 계층.
 *
 * 이 패키지 **밖으로 Prisma 타입이 나가지 않는 것**이 규칙입니다. 리포지토리는
 * 언제나 `@chzzk-bot/contracts` 의 모양으로 돌려줍니다. 그래야 나중에 저장소를
 * 바꾸거나 캐시를 끼워 넣을 때 호출부를 건드리지 않습니다.
 *
 * 예외는 `getPrisma` 와 트랜잭션이 필요한 곳뿐이며, 그 경우에도 리포지토리
 * 안에서만 씁니다.
 */

export { getPrisma, disconnectPrisma, PrismaClient, Prisma } from './client.js';

export { BotConfigRepository } from './repositories/botConfig.js';
export { ViewerRepository } from './repositories/viewers.js';
export { TenantRepository, toSlug } from './repositories/tenants.js';
export { UserRepository, toUserProfile, type ChzzkIdentity } from './repositories/users.js';
export { AuditRepository, type AuditEntry } from './repositories/audit.js';
export { BotRuntimeRepository } from './repositories/runtime.js';
export { SubscriptionRepository } from './repositories/subscriptions.js';
export { createRepositories, type Repositories } from './repositories/index.js';
