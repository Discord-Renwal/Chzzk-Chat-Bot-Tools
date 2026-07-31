import { PrismaClient } from '../generated/client/index.js';

export { Prisma } from '../generated/client/index.js';
export type * from '../generated/client/index.js';
export { PrismaClient };

/**
 * 프로세스당 하나의 커넥션 풀.
 *
 * `tsx watch` 로 개발할 때 모듈이 다시 평가될 때마다 새 PrismaClient 를 만들면
 * 커넥션이 계속 쌓여 몇 분 안에 Postgres 의 max_connections 에 닿습니다.
 * globalThis 에 얹어 두면 리로드를 넘어 같은 인스턴스를 재사용합니다.
 */
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export function getPrisma(): PrismaClient {
  globalForPrisma.prisma ??= new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
        : ['warn', 'error'],
  });
  return globalForPrisma.prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (globalForPrisma.prisma) {
    await globalForPrisma.prisma.$disconnect();
    globalForPrisma.prisma = undefined;
  }
}
