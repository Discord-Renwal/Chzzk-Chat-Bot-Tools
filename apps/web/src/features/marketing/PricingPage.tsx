import { Check, Loader2, Minus } from 'lucide-react';
import { Link } from 'react-router';
import { Button, Card, cn, EmptyState } from '@chzzk-bot/ui';
import { usePlans } from '../../shared/api/billing';
import { goToLogin, useSession } from '../../shared/api/session';
import type { Plan } from '../../shared/types';

/**
 * 요금제 (요구사항 1번의 "결제" 앞단).
 *
 * 플랜 정보를 하드코딩하지 않고 API 에서 받습니다. 가격을 바꿀 때 프런트 배포가
 * 필요하면, 결국 서버와 화면의 가격이 다른 순간이 생깁니다.
 */
export function PricingPage() {
  const plans = usePlans();
  const session = useSession();
  const loggedIn = Boolean(session.data);

  if (plans.isPending) {
    return (
      <div className="grid min-h-[50vh] place-items-center text-[var(--surface-muted)]">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (plans.isError) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20">
        <EmptyState title="요금제를 불러오지 못했습니다">
          <p>{plans.error.message}</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-4"
            onClick={() => void plans.refetch()}
          >
            다시 시도
          </Button>
        </EmptyState>
      </div>
    );
  }

  const list = plans.data?.plans ?? [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">요금제</h1>
      <p className="mt-3 text-[var(--surface-muted)]">
        가입하면 프로 요금제를 14일간 무료로 씁니다. 체험이 끝나도 자동으로 결제되지 않고, 무료
        요금제로 내려갑니다.
      </p>

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {list.map((plan) => (
          <PlanCard key={plan.code} plan={plan} loggedIn={loggedIn} />
        ))}
      </div>

      <p className="mt-8 text-xs leading-relaxed text-[var(--surface-muted)]">
        표시 금액은 부가세 포함입니다. 요금제를 올리면 남은 기간만큼 계산한 차액만 즉시 결제되고,
        내리면 이미 결제한 기간이 끝난 뒤에 적용됩니다. 여러 채널을 운영하신다면 파트너 요금제를
        문의해 주세요.
      </p>
    </div>
  );
}

function PlanCard({ plan, loggedIn }: { plan: Plan; loggedIn: boolean }) {
  // 가장 많이 고르는 플랜을 시각적으로 띄웁니다.
  const highlighted = plan.code === 'PRO';

  return (
    <Card className={cn('flex h-full flex-col', highlighted && 'ring-1 ring-brand')}>
      {highlighted ? (
        <span className="mb-2 inline-flex w-fit rounded-full bg-brand px-2.5 py-0.5 text-[11px] font-semibold text-brand-ink">
          가장 인기
        </span>
      ) : null}

      <h2 className="text-lg font-semibold">{plan.name}</h2>
      <p className="mt-1 text-sm text-[var(--surface-muted)]">{plan.description}</p>

      <p className="mt-5">
        <span className="text-3xl font-bold tracking-tight">
          {plan.priceMonthly === 0 ? '무료' : `${plan.priceMonthly.toLocaleString('ko-KR')}원`}
        </span>
        {plan.priceMonthly > 0 ? (
          <span className="ml-1 text-sm text-[var(--surface-muted)]">/ 월</span>
        ) : null}
      </p>

      <ul className="mt-5 flex-1 space-y-2 text-sm">
        {plan.features.map((feature) => (
          <li key={feature} className="flex gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-brand" />
            <span className="text-[var(--surface-muted)]">{feature}</span>
          </li>
        ))}
        {!plan.limits.publicApiEnabled ? (
          <li className="flex gap-2">
            <Minus className="mt-0.5 size-4 shrink-0 text-[var(--surface-muted)]" />
            <span className="text-[var(--surface-muted)]">명령 실행 API 미포함</span>
          </li>
        ) : null}
      </ul>

      <div className="mt-6">
        {loggedIn ? (
          <Button variant={highlighted ? 'primary' : 'secondary'} className="w-full" asChild>
            <Link to="/mypage/plan">
              {plan.priceMonthly === 0 ? '무료로 사용' : '이 요금제 선택'}
            </Link>
          </Button>
        ) : (
          <Button
            variant={highlighted ? 'primary' : 'secondary'}
            className="w-full"
            onClick={() => goToLogin()}
          >
            치지직으로 시작하기
          </Button>
        )}
      </div>
    </Card>
  );
}
