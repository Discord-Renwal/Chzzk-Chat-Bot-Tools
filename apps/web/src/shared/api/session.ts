import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import type { SessionUser, TenantSummary } from '../types';
import { ApiError, request } from './client';

export const SESSION_KEY = ['session'] as const;

/**
 * 로그인 상태.
 *
 * 401 을 **오류로 다루지 않습니다**. 로그인하지 않은 방문자는 정상적인 상태이고,
 * 랜딩 페이지에서 빨간 오류 토스트가 뜨면 안 됩니다. 대신 `null` 로 돌려주고
 * 화면이 로그인 버튼을 보여주게 합니다.
 */
export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: async (): Promise<SessionUser | null> => {
      try {
        return await request<SessionUser>('/auth/me');
      } catch (error) {
        if (error instanceof ApiError && error.isUnauthorized) return null;
        throw error;
      }
    },
    // 로그인 상태는 자주 바뀌지 않습니다. 탭을 옮길 때마다 다시 물을 이유가 없습니다.
    staleTime: 60_000,
    retry: false,
  });
}

export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => request('/auth/logout', 'POST'),
    onSuccess: () => {
      // 캐시를 통째로 비웁니다. 남겨 두면 다음 사람이 로그인했을 때 이전
      // 사용자의 채널 목록이 잠깐 보입니다.
      queryClient.clear();
      window.location.href = '/';
    },
  });
}

/** 치지직 로그인 페이지로 보냅니다. */
export function goToLogin(returnTo?: string): void {
  const target = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
  window.location.href = `/api/auth/login${target}`;
}

// ─── 활성 채널 ────────────────────────────────────────────────────────────────

export interface ActiveTenantValue {
  tenant: TenantSummary | null;
  tenants: TenantSummary[];
  setTenantId: (id: string) => void;
}

/**
 * "지금 보고 있는 채널".
 *
 * 대부분의 API 경로가 `/tenants/:tenantId/...` 라서, 화면마다 채널 ID 를 들고
 * 다니면 한 군데만 빠뜨려도 다른 채널의 설정을 보여주게 됩니다. 컨텍스트로
 * 한 번만 정하고 훅이 자동으로 가져다 쓰게 합니다.
 */
export const ActiveTenantContext = createContext<ActiveTenantValue>({
  tenant: null,
  tenants: [],
  setTenantId: () => {},
});

export function useActiveTenant(): ActiveTenantValue {
  return useContext(ActiveTenantContext);
}

/**
 * 훅 안에서 쓰는 채널 ID.
 *
 * 아직 정해지지 않았으면 빈 문자열을 돌려주고, 호출부는 `enabled` 로 쿼리를
 * 막습니다. 예외를 던지면 로딩 중에 화면 전체가 깨집니다.
 */
export function useTenantId(): string {
  return useActiveTenant().tenant?.id ?? '';
}
