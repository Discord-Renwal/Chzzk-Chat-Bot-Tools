import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { BillingCard, Payment, Plan, PlanCode, Subscription } from '../types';
import { request } from './client';
import { useTenantId } from './session';

/**
 * 요금제 · 구독 · 결제 훅 (요구사항 1번의 "결제").
 *
 * 결제창을 띄우는 부분은 `usePortOne` 에 모아 두었습니다. PG SDK 는 전역
 * 스크립트를 로드하는 방식이라, 여러 화면에서 각자 부르면 로드 상태를 서로
 * 모른 채 중복으로 붙습니다.
 */

export const PLANS_KEY = ['plans'] as const;
export const CARDS_KEY = ['billing-cards'] as const;
const subscriptionKey = (tenantId: string) => ['subscription', tenantId] as const;
const paymentsKey = (tenantId: string) => ['payments', tenantId] as const;

export function usePlans() {
  return useQuery({
    queryKey: PLANS_KEY,
    queryFn: () => request<{ plans: Plan[] }>('/plans'),
    // 요금제는 거의 바뀌지 않습니다. 랜딩 페이지가 매번 다시 부를 이유가 없습니다.
    staleTime: 5 * 60_000,
  });
}

export function useSubscription() {
  const tenantId = useTenantId();

  return useQuery({
    queryKey: subscriptionKey(tenantId),
    queryFn: () => request<Subscription>(`/tenants/${tenantId}/subscription`),
    enabled: Boolean(tenantId),
  });
}

export function usePayments() {
  const tenantId = useTenantId();

  return useQuery({
    queryKey: paymentsKey(tenantId),
    queryFn: () => request<{ payments: Payment[] }>(`/tenants/${tenantId}/payments`),
    enabled: Boolean(tenantId),
  });
}

export function useBillingCards() {
  return useQuery({
    queryKey: CARDS_KEY,
    queryFn: () => request<{ cards: BillingCard[] }>('/billing/cards'),
  });
}

export function useBillingConfig() {
  return useQuery({
    queryKey: ['billing-config'] as const,
    queryFn: () =>
      request<{ provider: 'portone' | 'mock'; storeId: string; channelKey: string }>(
        '/billing/config'
      ),
    staleTime: Infinity,
  });
}

function useBillingMutation<TVars, TResult>(
  fn: (tenantId: string, vars: TVars) => Promise<TResult>,
  message: string | ((result: TResult) => string)
) {
  const queryClient = useQueryClient();
  const tenantId = useTenantId();

  return useMutation({
    mutationFn: (vars: TVars) => fn(tenantId, vars),
    onSuccess: (result) => {
      // 구독이 바뀌면 한도와 봇 상태까지 함께 달라집니다. 관련 캐시를 모두 비웁니다.
      void queryClient.invalidateQueries({ queryKey: subscriptionKey(tenantId) });
      void queryClient.invalidateQueries({ queryKey: paymentsKey(tenantId) });
      void queryClient.invalidateQueries({ queryKey: ['usage', tenantId] });
      void queryClient.invalidateQueries({ queryKey: CARDS_KEY });
      toast.success(typeof message === 'function' ? message(result) : message);
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

/** 카드 등록 + 플랜 적용을 한 번에 */
export function useCheckout() {
  return useBillingMutation(
    (tenantId, vars: { planCode: PlanCode; issueId: string; billingKeyRequestId: string }) =>
      request<{ charged: number; scheduled: boolean }>(
        `/tenants/${tenantId}/subscription/checkout`,
        'POST',
        vars
      ),
    (result) =>
      result.charged > 0
        ? `결제가 완료됐습니다 (${result.charged.toLocaleString('ko-KR')}원).`
        : '요금제를 적용했습니다.'
  );
}

export function useChangePlan() {
  return useBillingMutation(
    (tenantId, planCode: PlanCode) =>
      request<{ charged: number; scheduled: boolean }>(
        `/tenants/${tenantId}/subscription/plan`,
        'POST',
        { planCode }
      ),
    (result) =>
      result.scheduled
        ? '다음 결제일부터 적용됩니다.'
        : result.charged > 0
          ? `요금제를 올렸습니다 (차액 ${result.charged.toLocaleString('ko-KR')}원 결제).`
          : '요금제를 변경했습니다.'
  );
}

export function useCancelSubscription() {
  return useBillingMutation(
    (tenantId, vars: { immediate: boolean; reason: string }) =>
      request<Subscription>(`/tenants/${tenantId}/subscription/cancel`, 'POST', vars),
    '해지 요청을 접수했습니다.'
  );
}

export function useResumeSubscription() {
  return useBillingMutation(
    (tenantId) => request<Subscription>(`/tenants/${tenantId}/subscription/resume`, 'POST'),
    '구독을 다시 시작했습니다.'
  );
}

export function useRegisterCard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (issueId: string) => request<BillingCard>('/billing/cards', 'POST', { issueId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CARDS_KEY });
      toast.success('결제 수단을 등록했습니다.');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useRemoveCard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (cardId: string) => request(`/billing/cards/${cardId}`, 'DELETE'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CARDS_KEY });
      toast.success('결제 수단을 삭제했습니다.');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}
