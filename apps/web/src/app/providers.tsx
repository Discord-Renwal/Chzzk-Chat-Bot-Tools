import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BrowserRouter } from 'react-router';
import { Toaster } from 'sonner';
import * as Tooltip from '@radix-ui/react-tooltip';
import { ActiveTenantContext, useSession } from '../shared/api/session';

const TENANT_STORAGE_KEY = 'chzzk-bot:active-tenant';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 네트워크 오류는 한 번만 재시도합니다. 로그인 만료(401)처럼 재시도해도
      // 달라지지 않는 실패에 매달리면 화면이 몇 초씩 멈춥니다.
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

/**
 * 지금 보고 있는 채널을 정합니다.
 *
 * 선택을 localStorage 에 남기는 이유는, 채널을 여럿 가진 사람이 새로고침할
 * 때마다 첫 번째 채널로 돌아가면 매번 다시 고르게 되기 때문입니다.
 * 저장된 값이 더 이상 접근할 수 없는 채널이면(매니저에서 빠졌거나 삭제됨)
 * 조용히 첫 번째로 되돌립니다.
 */
function ActiveTenantProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const tenants = useMemo(() => session.data?.tenants ?? [], [session.data]);

  const [preferredId, setPreferredId] = useState<string | null>(() =>
    localStorage.getItem(TENANT_STORAGE_KEY)
  );

  /*
   * 저장된 선택이 유효하지 않으면 첫 번째로 넘어갑니다.
   *
   * 상태를 고쳐 되돌리지 않고 **렌더할 때 계산만** 합니다. 이펙트에서 setState
   * 를 부르면 렌더가 한 번 더 도는데, 얻는 게 없습니다 — 어차피 다음 선택에서
   * localStorage 가 덮이고, 그 전까지는 여기 계산이 정답을 줍니다.
   */
  const active = tenants.find((t) => t.id === preferredId) ?? tenants[0] ?? null;

  const value = useMemo(
    () => ({
      tenant: active,
      tenants,
      setTenantId: (id: string) => {
        setPreferredId(id);
        localStorage.setItem(TENANT_STORAGE_KEY, id);
      },
    }),
    [active, tenants]
  );

  return <ActiveTenantContext.Provider value={value}>{children}</ActiveTenantContext.Provider>;
}

/** 다크/라이트 초기값을 첫 페인트 전에 맞춰, 화면이 하얗게 번쩍이지 않게 합니다. */
function useTheme(): void {
  useEffect(() => {
    const dark = localStorage.getItem('theme') !== 'light';
    document.documentElement.classList.toggle('dark', dark);
  }, []);
}

export function Providers({ children }: { children: ReactNode }) {
  useTheme();

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Tooltip.Provider delayDuration={200}>
          <ActiveTenantProvider>{children}</ActiveTenantProvider>
        </Tooltip.Provider>
      </BrowserRouter>
      <Toaster
        position="bottom-center"
        theme="system"
        toastOptions={{
          style: {
            background: 'var(--surface-panel)',
            border: '1px solid var(--surface-border)',
            color: 'var(--surface-text)',
          },
        }}
      />
    </QueryClientProvider>
  );
}
