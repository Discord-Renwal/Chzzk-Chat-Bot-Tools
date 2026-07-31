import { PLAN_CATALOG } from '@chzzk-bot/contracts';
import { getPrisma } from '../src/client.js';

/**
 * 플랜 카탈로그를 DB 에 반영합니다.
 *
 * 플랜은 코드에 정의하고(`PLAN_CATALOG`) DB 로 밀어 넣습니다. 반대로 하면
 * 가격과 한도가 환경마다 달라져, 스테이징에서 통과한 한도 검사가 운영에서
 * 다르게 동작합니다. 이 스크립트는 몇 번 돌려도 결과가 같습니다.
 */
async function main(): Promise<void> {
  const prisma = getPrisma();

  for (const plan of PLAN_CATALOG) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      create: {
        code: plan.code,
        name: plan.name,
        description: plan.description,
        priceMonthly: plan.priceMonthly,
        features: plan.features,
        limits: plan.limits,
        isPublic: plan.isPublic,
        sortOrder: plan.sortOrder,
      },
      update: {
        name: plan.name,
        description: plan.description,
        priceMonthly: plan.priceMonthly,
        features: plan.features,
        limits: plan.limits,
        isPublic: plan.isPublic,
        sortOrder: plan.sortOrder,
        active: true,
      },
    });
    console.log(`플랜 반영: ${plan.code} (${plan.priceMonthly.toLocaleString('ko-KR')}원/월)`);
  }

  // 첫 배포에서 관리자 콘솔에 아무도 못 들어가는 상황을 막습니다.
  // 이미 최고 관리자가 있으면 아무것도 하지 않습니다.
  const bootstrapChannelId = process.env.BOOTSTRAP_SUPER_ADMIN_CHANNEL_ID;
  if (bootstrapChannelId) {
    const existing = await prisma.user.count({ where: { platformRole: 'SUPER_ADMIN' } });
    if (existing === 0) {
      await prisma.user.upsert({
        where: { chzzkChannelId: bootstrapChannelId },
        create: {
          chzzkChannelId: bootstrapChannelId,
          channelName: '최초 관리자',
          platformRole: 'SUPER_ADMIN',
        },
        update: { platformRole: 'SUPER_ADMIN' },
      });
      console.log(`최초 관리자 지정: ${bootstrapChannelId}`);
    }
  }

  await prisma.$disconnect();
}

await main();
