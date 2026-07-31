import { AlertTriangle, Bot, Building2, Loader2, TrendingUp, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { SUBSCRIPTION_STATUS_LABELS, type SubscriptionStatus } from '@chzzk-bot/contracts';
import { Card, CardTitle, cn } from '@chzzk-bot/ui';
import { PageHeader } from '../app/ConsoleLayout';
import { useMetrics } from '../shared/api';

/**
 * 운영 개요.
 *
 * 지표는 "지금 문제가 있는가" 에 답하는 것부터 배치합니다. 매출은 아래쪽입니다 —
 * 매출은 하루 뒤에 봐도 되지만, 오류 상태의 봇 12개는 지금 봐야 합니다.
 */
export function OverviewPage() {
  const metrics = useMetrics();

  if (metrics.isPending) {
    return (
      <div className="flex justify-center py-24 text-[var(--surface-muted)]">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (metrics.isError) {
    return <p className="text-sm text-red-400">{metrics.error.message}</p>;
  }

  const data = metrics.data;

  return (
    <div>
      <PageHeader title="개요" description="지난 7일 기준입니다." />

      {/* 이상 신호 먼저 */}
      {data.bots.error > 0 || data.revenue.failedPaymentsLast7Days > 0 ? (
        <Card className="mb-5 border-amber-500/30 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-400" />
            <div>
              <CardTitle>확인이 필요합니다</CardTitle>
              <ul className="mt-1.5 space-y-0.5 text-sm text-[var(--surface-muted)]">
                {data.bots.error > 0 ? (
                  <li>오류 상태의 봇 {data.bots.error}개 — 대부분 재인증이 필요한 계정입니다.</li>
                ) : null}
                {data.revenue.failedPaymentsLast7Days > 0 ? (
                  <li>
                    결제 실패 {data.revenue.failedPaymentsLast7Days}건 — 유예 기간 중 재시도됩니다.
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={<Users className="size-4" />}
          label="전체 사용자"
          value={data.users.total.toLocaleString('ko-KR')}
          sub={`7일 신규 ${data.users.newLast7Days} · 활성 ${data.users.activeLast7Days}`}
        />
        <Stat
          icon={<Building2 className="size-4" />}
          label="채널"
          value={data.tenants.total.toLocaleString('ko-KR')}
          sub={`활성 ${data.tenants.active} · 정지 ${data.tenants.suspended}`}
        />
        <Stat
          icon={<Bot className="size-4" />}
          label="실행 중인 봇"
          value={data.bots.running.toLocaleString('ko-KR')}
          sub={`입장 ${data.bots.joined} · 오류 ${data.bots.error}`}
          tone={data.bots.error > 0 ? 'warn' : 'default'}
        />
        <Stat
          icon={<TrendingUp className="size-4" />}
          label="MRR"
          value={`${data.revenue.mrr.toLocaleString('ko-KR')}원`}
          sub={`이번 달 입금 ${data.revenue.thisMonth.toLocaleString('ko-KR')}원`}
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>구독 상태</CardTitle>
          <ul className="mt-3 space-y-2 text-sm">
            {Object.entries(data.subscriptions).map(([status, count]) => (
              <li key={status} className="flex items-center justify-between">
                <span className="text-[var(--surface-muted)]">
                  {SUBSCRIPTION_STATUS_LABELS[status as SubscriptionStatus] ?? status}
                </span>
                <span className="tabular-nums font-medium">{count.toLocaleString('ko-KR')}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardTitle>요금제 분포</CardTitle>
          <ul className="mt-3 space-y-2 text-sm">
            {data.planBreakdown.map((row) => (
              <li key={row.planCode} className="flex items-center justify-between">
                <span className="text-[var(--surface-muted)]">{row.planCode}</span>
                <span className="tabular-nums font-medium">
                  {row.count.toLocaleString('ko-KR')}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-5">
        <CardTitle>매출</CardTitle>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-[var(--surface-muted)]">이번 달</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {data.revenue.thisMonth.toLocaleString('ko-KR')}원
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--surface-muted)]">지난 달</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {data.revenue.lastMonth.toLocaleString('ko-KR')}원
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--surface-muted)]">
              MRR{' '}
              <span className="text-[10px]">
                (유효 유료 구독의 월 정가 합 — 실제 입금액과 다릅니다)
              </span>
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {data.revenue.mrr.toLocaleString('ko-KR')}원
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  tone = 'default',
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub: string;
  tone?: 'default' | 'warn';
}) {
  return (
    <Card>
      <div
        className={cn(
          'flex items-center gap-2 text-xs',
          tone === 'warn' ? 'text-amber-400' : 'text-[var(--surface-muted)]'
        )}
      >
        {icon}
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-[var(--surface-muted)]">{sub}</p>
    </Card>
  );
}
