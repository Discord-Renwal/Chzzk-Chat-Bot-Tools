import type { AppContext } from './context.js';

/** 정기결제·만료·정리 배치를 도는 주기 */
const BILLING_INTERVAL_MS = 60 * 60 * 1000; // 1시간
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6시간

/**
 * 주기 작업.
 *
 * 별도 워커나 큐를 쓰지 않고 API 프로세스 안에서 돕니다. 지금 규모에서는
 * 인프라를 하나 더 늘릴 이유가 없습니다. 다만 API 를 여러 대로 늘리는 순간
 * **같은 배치가 여러 번 돌게 되므로**, 그때는 이 파일을 전용 워커로 떼거나
 * DB 잠금(advisory lock)을 걸어야 합니다. 지금은 정기결제가 멱등하도록
 * 만들어(같은 주문번호로 두 번 청구되지 않음) 그 위험을 줄여 두었습니다.
 *
 * 실행 주기가 1시간인 이유는, 결제일은 날짜 단위라 정확한 시각이 중요하지 않고,
 * 재시작으로 한 번 걸러도 다음 시간에 따라잡기 때문입니다.
 */
export function startScheduler(context: AppContext): { stop: () => void } {
  const log = context.logger.child('scheduler');
  const timers: NodeJS.Timeout[] = [];

  async function runBilling(): Promise<void> {
    try {
      const billed = await context.subscriptions.runBillingCycle();
      const expired = await context.subscriptions.expireOverdue();

      if (billed.charged || billed.failed || expired.expired || expired.renewed) {
        log.info(
          `정기결제 성공 ${billed.charged} / 실패 ${billed.failed}, ` +
            `갱신 ${expired.renewed} / 만료 ${expired.expired}`
        );
      }
    } catch (error) {
      log.error('결제 배치 실행 중 오류', error);
    }
  }

  async function runCleanup(): Promise<void> {
    try {
      const sessions = await context.sessions.pruneExpired();
      const stale = await context.repositories.runtime.reapStale();

      // 플랜별 보관 기간이 지난 이벤트 로그를 지웁니다. 지우지 않으면 이 테이블만
      // 무한히 커지고, 정작 최근 로그 조회가 느려집니다.
      const tenants = await context.repositories.prisma.tenant.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });

      let prunedEvents = 0;
      for (const tenant of tenants) {
        const limits = await context.entitlements.limits(tenant.id);
        if (!limits) continue;
        prunedEvents += await context.repositories.runtime.pruneEvents(
          tenant.id,
          limits.eventRetentionDays
        );
      }

      if (sessions || stale || prunedEvents) {
        log.info(
          `정리 — 세션 ${sessions}, 응답없는 봇 ${stale}, 이벤트 로그 ${prunedEvents}건 삭제`
        );
      }
    } catch (error) {
      log.error('정리 배치 실행 중 오류', error);
    }
  }

  // 부팅 직후에 한 번 돕니다. 서버가 며칠 내려가 있었다면 밀린 결제가 있습니다.
  // 다만 배포 직후 트래픽이 몰리는 시점을 피하려고 1분 뒤로 미룹니다.
  const kickoff = setTimeout(() => {
    void runBilling();
    void runCleanup();
  }, 60_000);
  timers.push(kickoff);

  timers.push(setInterval(() => void runBilling(), BILLING_INTERVAL_MS));
  timers.push(setInterval(() => void runCleanup(), CLEANUP_INTERVAL_MS));

  for (const timer of timers) timer.unref?.();

  return {
    stop: () => {
      for (const timer of timers) clearInterval(timer);
    },
  };
}
