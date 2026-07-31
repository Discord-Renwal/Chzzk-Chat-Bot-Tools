import { Check, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button, Card, CardTitle, cn, ConfirmDialog, Field, Textarea } from '@chzzk-bot/ui';
import {
  useBillingConfig,
  useCancelSubscription,
  useChangePlan,
  useCheckout,
  useResumeSubscription,
  useSubscription,
  usePlans,
} from '../../shared/api/billing';
import { useSession } from '../../shared/api/session';
import { issueBillingKey, issueMockBillingKey } from '../../shared/portone';
import { SUBSCRIPTION_STATUS_LABELS, type Plan, type PlanCode } from '../../shared/types';

/**
 * 요금제 변경 · 결제 (요구사항 1번의 "결제").
 *
 * 결제 수단이 없으면 결제창을 먼저 띄우고, 있으면 바로 플랜만 바꿉니다. 두 흐름을
 * 화면에서 구분해 보여주지 않는 이유는, 사용자에게는 "이 요금제 쓰기" 하나이기
 * 때문입니다. 카드가 있는지 없는지는 우리 사정입니다.
 */
export function PlanPage() {
  const plans = usePlans();
  const subscription = useSubscription();
  const billingConfig = useBillingConfig();
  const session = useSession();

  const checkout = useCheckout();
  const changePlan = useChangePlan();
  const cancel = useCancelSubscription();
  const resume = useResumeSubscription();

  const [pendingCode, setPendingCode] = useState<PlanCode | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);

  const current = subscription.data;
  const user = session.data?.user;
  const busy = checkout.isPending || changePlan.isPending;

  async function selectPlan(plan: Plan): Promise<void> {
    if (!current || !user) return;
    if (plan.code === current.plan.code) return;

    setPendingCode(plan.code);
    try {
      // 무료로 내려가는 것과 이미 카드가 있는 경우는 결제창이 필요 없습니다.
      if (plan.priceMonthly === 0 || current.hasBillingKey) {
        await changePlan.mutateAsync(plan.code);
        return;
      }

      const config = billingConfig.data;
      if (!config) {
        toast.error('결제 설정을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.');
        return;
      }

      // 로컬 개발에서는 PG 계정 없이도 흐름을 눌러 볼 수 있어야 합니다.
      const issued =
        config.provider === 'mock'
          ? issueMockBillingKey(user.id)
          : await issueBillingKey({
              storeId: config.storeId,
              channelKey: config.channelKey,
              customerId: user.id,
              customerName: user.channelName,
              planName: plan.name,
            });

      await checkout.mutateAsync({
        planCode: plan.code,
        issueId: issued.issueId,
        billingKeyRequestId: issued.billingKeyRequestId,
      });
    } catch (error) {
      // 사용자가 결제창을 닫은 경우도 여기로 옵니다. 오류로 보이지 않게 문장을 그대로 씁니다.
      toast.error(error instanceof Error ? error.message : '결제를 완료하지 못했습니다.');
    } finally {
      setPendingCode(null);
    }
  }

  if (plans.isPending || subscription.isPending) {
    return (
      <div className="grid min-h-[50vh] place-items-center text-[var(--surface-muted)]">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">요금제</h1>
      <p className="mt-2 text-sm text-[var(--surface-muted)]">
        올리면 남은 기간만큼 계산한 차액만 즉시 결제되고, 내리면 이미 결제한 기간이 끝난 뒤에
        적용됩니다.
      </p>

      {current ? (
        <Card className="mt-6">
          <CardTitle>현재 이용 중</CardTitle>
          <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <p className="text-lg font-semibold">{current.plan.name}</p>
            <p className="text-[var(--surface-muted)]">
              {SUBSCRIPTION_STATUS_LABELS[current.status]} · {formatDate(current.currentPeriodEnd)}
              까지
            </p>
            <p className="text-[var(--surface-muted)]">
              결제 수단 {current.hasBillingKey ? '등록됨' : '없음'}
            </p>
          </div>

          {current.cancelAtPeriodEnd ? (
            <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-sm text-amber-400">
                {formatDate(current.currentPeriodEnd)}에 해지될 예정입니다. 그때까지는 그대로 이용할
                수 있습니다.
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                loading={resume.isPending}
                onClick={() => resume.mutate(undefined)}
              >
                해지 취소
              </Button>
            </div>
          ) : null}

          {current.status === 'PAST_DUE' ? (
            <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
              <p className="text-sm text-red-400">
                결제에 실패했습니다. 유예 기간 동안은 그대로 쓸 수 있지만, 결제 수단을 확인해
                주세요.
              </p>
              <Button variant="secondary" size="sm" className="mt-3" asChild>
                <Link to="/mypage/billing">결제 수단 관리</Link>
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {(plans.data?.plans ?? []).map((plan) => {
          const isCurrent = current?.plan.code === plan.code;
          return (
            <Card
              key={plan.code}
              className={cn('flex h-full flex-col', isCurrent && 'ring-1 ring-brand')}
            >
              <h2 className="text-lg font-semibold">{plan.name}</h2>
              <p className="mt-1 text-sm text-[var(--surface-muted)]">{plan.description}</p>

              <p className="mt-4">
                <span className="text-2xl font-bold tracking-tight">
                  {plan.priceMonthly === 0
                    ? '무료'
                    : `${plan.priceMonthly.toLocaleString('ko-KR')}원`}
                </span>
                {plan.priceMonthly > 0 ? (
                  <span className="ml-1 text-sm text-[var(--surface-muted)]">/ 월</span>
                ) : null}
              </p>

              <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-brand" />
                    <span className="text-[var(--surface-muted)]">{feature}</span>
                  </li>
                ))}
              </ul>

              <Button
                className="mt-5 w-full"
                variant={isCurrent ? 'secondary' : 'primary'}
                disabled={isCurrent || busy}
                loading={pendingCode === plan.code}
                onClick={() => void selectPlan(plan)}
              >
                {isCurrent
                  ? '이용 중'
                  : plan.priceMonthly === 0
                    ? '무료로 내리기'
                    : '이 요금제 쓰기'}
              </Button>
            </Card>
          );
        })}
      </div>

      {current && current.plan.priceMonthly > 0 && !current.cancelAtPeriodEnd ? (
        <Card className="mt-8">
          <CardTitle>구독 해지</CardTitle>
          <p className="mt-1 text-sm text-[var(--surface-muted)]">
            해지해도 이미 결제한 기간이 끝날 때까지는 그대로 쓸 수 있습니다. 명령어와 포인트
            데이터는 지워지지 않습니다.
          </p>

          <Field label="해지 사유" hint="서비스를 고치는 데 씁니다. 비워 두셔도 됩니다.">
            <Textarea
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="예: 방송을 쉬게 되어서"
              rows={2}
            />
          </Field>

          <Button
            variant="danger"
            size="sm"
            className="mt-3"
            loading={cancel.isPending}
            onClick={() => setCancelOpen(true)}
          >
            구독 해지
          </Button>

          <ConfirmDialog
            open={cancelOpen}
            onOpenChange={setCancelOpen}
            title="구독을 해지할까요?"
            description={`${formatDate(current.currentPeriodEnd)}까지 이용할 수 있고, 그 뒤 무료 요금제로 내려갑니다.`}
            confirmLabel="해지하기"
            onConfirm={() => cancel.mutate({ immediate: false, reason: cancelReason })}
          />
        </Card>
      ) : null}
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
