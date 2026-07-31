import { Loader2 } from 'lucide-react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useSession } from '../shared/api/session';

/**
 * 로그인하지 않았으면 로그인 화면으로 보냅니다.
 *
 * 로딩 중에 리디렉트하지 않는 게 중요합니다. 세션 조회가 끝나기 전에 판단하면,
 * 로그인한 사용자가 새로고침할 때마다 로그인 화면이 한 번 번쩍입니다.
 *
 * 원래 가려던 주소는 쿼리로 넘겨, 로그인 뒤 그 자리로 돌아오게 합니다.
 */
export function RequireAuth() {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) {
    return (
      <div className="grid min-h-dvh place-items-center text-[var(--surface-muted)]">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  if (!session.data) {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?returnTo=${returnTo}`} replace />;
  }

  return <Outlet />;
}
