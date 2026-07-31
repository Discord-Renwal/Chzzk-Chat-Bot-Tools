import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  AdminMetrics,
  AdminTenantRow,
  AdminUserRow,
  Announcement,
  AuditLogRow,
  ErrorCode,
  FeatureFlag,
  Paginated,
  PlatformRole,
  SessionUser,
} from '@chzzk-bot/contracts';

/**
 * 콘솔이 쓰는 데이터 접근.
 *
 * 사용자 웹과 같은 API 서버를 보지만 `/api/admin/*` 만 부릅니다. 내부 관리자가
 * 아닌 계정으로 열면 서버가 404 를 주므로, 화면은 "권한 없음" 대신 로그인
 * 화면을 보여줍니다 — 콘솔의 존재 자체를 알리지 않기 위해서입니다.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK'
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError('서버에 연결할 수 없습니다.', 0, 'NETWORK');
  }

  const text = await response.text();
  const data: unknown = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const envelope = data as { error?: { code?: ErrorCode; message?: string } };
    throw new ApiError(
      envelope.error?.message ?? `${response.status} 오류`,
      response.status,
      envelope.error?.code ?? 'INTERNAL'
    );
  }
  return data as T;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

// ─── 세션 ─────────────────────────────────────────────────────────────────────

export function useStaffSession() {
  return useQuery({
    queryKey: ['session'] as const,
    queryFn: async (): Promise<SessionUser | null> => {
      try {
        return await request<SessionUser>('/auth/me');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 60_000,
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: () => request('/auth/logout', 'POST'),
    onSuccess: () => {
      window.location.href = '/';
    },
  });
}

// ─── 지표 ─────────────────────────────────────────────────────────────────────

export function useMetrics() {
  return useQuery({
    queryKey: ['admin', 'metrics'] as const,
    queryFn: () => request<AdminMetrics>('/admin/metrics'),
    refetchInterval: 60_000,
  });
}

// ─── 사용자 ───────────────────────────────────────────────────────────────────

export interface UserFilter {
  q: string;
  status?: string | undefined;
  platformRole?: string;
  page: number;
}

export function useUsers(filter: UserFilter) {
  return useQuery({
    queryKey: ['admin', 'users', filter] as const,
    queryFn: () =>
      request<Paginated<AdminUserRow>>(
        `/admin/users${query({
          q: filter.q,
          status: filter.status,
          platformRole: filter.platformRole,
          page: filter.page,
          size: 20,
        })}`
      ),
    // 목록을 훑는 중 페이지가 비었다가 채워지면 시선이 튑니다.
    placeholderData: (previous) => previous,
  });
}

export function useUserDetail(userId: string | null) {
  return useQuery({
    queryKey: ['admin', 'user', userId] as const,
    queryFn: () => request<Record<string, unknown>>(`/admin/users/${userId!}`),
    enabled: Boolean(userId),
  });
}

/** 관리 동작은 성공/실패를 반드시 토스트로 알립니다. 조용히 끝나면 눌렀는지 알 수 없습니다. */
function useAdminMutation<TVars>(
  fn: (vars: TVars) => Promise<unknown>,
  message: string,
  invalidate: readonly (readonly unknown[])[]
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of invalidate) void queryClient.invalidateQueries({ queryKey: key });
      toast.success(message);
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useSuspendUser() {
  return useAdminMutation(
    ({ userId, ...body }: { userId: string; reason: string; until?: string; stopBots: boolean }) =>
      request(`/admin/users/${userId}/suspend`, 'POST', body),
    '계정을 정지했습니다.',
    [
      ['admin', 'users'],
      ['admin', 'user'],
      ['admin', 'metrics'],
    ]
  );
}

export function useReinstateUser() {
  return useAdminMutation(
    ({ userId, reason }: { userId: string; reason: string }) =>
      request(`/admin/users/${userId}/reinstate`, 'POST', { reason }),
    '정지를 해제했습니다.',
    [
      ['admin', 'users'],
      ['admin', 'user'],
      ['admin', 'metrics'],
    ]
  );
}

export function useChangeRole() {
  return useAdminMutation(
    ({
      userId,
      platformRole,
      reason,
    }: {
      userId: string;
      platformRole: PlatformRole;
      reason: string;
    }) => request(`/admin/users/${userId}/role`, 'POST', { platformRole, reason }),
    '권한을 변경했습니다.',
    [
      ['admin', 'users'],
      ['admin', 'user'],
    ]
  );
}

// ─── 채널 ─────────────────────────────────────────────────────────────────────

export function useTenants(filter: { q: string; status?: string | undefined; page: number }) {
  return useQuery({
    queryKey: ['admin', 'tenants', filter] as const,
    queryFn: () =>
      request<Paginated<AdminTenantRow>>(
        `/admin/tenants${query({ q: filter.q, status: filter.status, page: filter.page, size: 20 })}`
      ),
    placeholderData: (previous) => previous,
  });
}

export function useControlBot() {
  return useAdminMutation(
    ({
      tenantId,
      action,
      reason,
    }: {
      tenantId: string;
      action: 'start' | 'stop';
      reason: string;
    }) => request(`/admin/tenants/${tenantId}/bot/${action}`, 'POST', { reason }),
    '봇 상태를 변경했습니다.',
    [
      ['admin', 'tenants'],
      ['admin', 'metrics'],
    ]
  );
}

export function useOverrideSubscription() {
  return useAdminMutation(
    ({
      tenantId,
      ...body
    }: {
      tenantId: string;
      planCode: string;
      periodEnd: string;
      reason: string;
    }) => request(`/admin/tenants/${tenantId}/subscription`, 'POST', body),
    '요금제를 적용했습니다.',
    [
      ['admin', 'tenants'],
      ['admin', 'metrics'],
    ]
  );
}

// ─── 결제 ─────────────────────────────────────────────────────────────────────

export interface AdminPaymentRow {
  id: string;
  paymentId: string;
  tenantId: string;
  orderName: string;
  amount: number;
  refundedAmount: number;
  status: string;
  paidAt: string | null;
  failureReason: string | null;
  createdAt: string;
  tenant: { channelName: string; slug: string };
}

export function usePayments(filter: { status?: string | undefined; page: number }) {
  return useQuery({
    queryKey: ['admin', 'payments', filter] as const,
    queryFn: () =>
      request<Paginated<AdminPaymentRow>>(
        `/admin/payments${query({ status: filter.status, page: filter.page, size: 20 })}`
      ),
    placeholderData: (previous) => previous,
  });
}

export function useRefund() {
  return useAdminMutation(
    (body: { paymentId: string; amount?: number; reason: string }) =>
      request('/admin/payments/refund', 'POST', body),
    '환불했습니다.',
    [
      ['admin', 'payments'],
      ['admin', 'metrics'],
    ]
  );
}

// ─── 감사 로그 ────────────────────────────────────────────────────────────────

export function useAuditLogs(filter: { action: string; actorId: string; page: number }) {
  return useQuery({
    queryKey: ['admin', 'audit', filter] as const,
    queryFn: () =>
      request<Paginated<AuditLogRow>>(
        `/admin/audit-logs${query({
          action: filter.action,
          actorId: filter.actorId,
          page: filter.page,
          size: 30,
        })}`
      ),
    placeholderData: (previous) => previous,
  });
}

// ─── 공지 ─────────────────────────────────────────────────────────────────────

export function useAnnouncements() {
  return useQuery({
    queryKey: ['admin', 'announcements'] as const,
    queryFn: () => request<{ announcements: Announcement[] }>('/admin/announcements'),
  });
}

export function useCreateAnnouncement() {
  return useAdminMutation(
    (body: {
      title: string;
      body: string;
      level: string;
      publishedAt: string | null;
      expiresAt: string | null;
    }) => request('/admin/announcements', 'POST', body),
    '공지를 등록했습니다.',
    [['admin', 'announcements']]
  );
}

export function useDeleteAnnouncement() {
  return useAdminMutation(
    (id: string) => request(`/admin/announcements/${id}`, 'DELETE'),
    '공지를 삭제했습니다.',
    [['admin', 'announcements']]
  );
}

// ─── 기능 플래그 ──────────────────────────────────────────────────────────────

export function useFeatureFlags() {
  return useQuery({
    queryKey: ['admin', 'flags'] as const,
    queryFn: () => request<{ flags: FeatureFlag[] }>('/admin/feature-flags'),
  });
}

export function useUpsertFeatureFlag() {
  return useAdminMutation(
    (body: {
      key: string;
      description: string;
      enabled: boolean;
      rolloutPercent: number;
      allowTenantIds: string[];
    }) => request('/admin/feature-flags', 'PUT', body),
    '기능 플래그를 저장했습니다.',
    [['admin', 'flags']]
  );
}
