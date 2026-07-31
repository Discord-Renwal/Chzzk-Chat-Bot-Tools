import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { Loader2 } from 'lucide-react';
import { isStaff } from '@chzzk-bot/contracts';
import { useStaffSession } from '../shared/api';
import { ConsoleLayout } from './ConsoleLayout';
import { SignInPage } from './SignInPage';

const OverviewPage = lazy(() =>
  import('../features/OverviewPage').then((m) => ({ default: m.OverviewPage }))
);
const UsersPage = lazy(() =>
  import('../features/UsersPage').then((m) => ({ default: m.UsersPage }))
);
const TenantsPage = lazy(() =>
  import('../features/TenantsPage').then((m) => ({ default: m.TenantsPage }))
);
const PaymentsPage = lazy(() =>
  import('../features/PaymentsPage').then((m) => ({ default: m.PaymentsPage }))
);
const AuditLogPage = lazy(() =>
  import('../features/AuditLogPage').then((m) => ({ default: m.AuditLogPage }))
);
const AnnouncementsPage = lazy(() =>
  import('../features/AnnouncementsPage').then((m) => ({ default: m.AnnouncementsPage }))
);
const FeatureFlagsPage = lazy(() =>
  import('../features/FeatureFlagsPage').then((m) => ({ default: m.FeatureFlagsPage }))
);

/**
 * 내부 관리자 콘솔 (요구사항 3번).
 *
 * 로그인하지 않았거나 내부 관리자가 아니면 **같은 화면**을 보여줍니다. 두 경우를
 * 구분해 "권한이 없습니다" 라고 알려주면, 일반 사용자에게 이 콘솔의 존재와
 * 자기 계정이 유효하다는 사실을 함께 알려주는 셈입니다.
 *
 * 물론 진짜 방어선은 서버입니다(`requireStaff`). 여기 검사는 화면을 정리하는
 * 용도이며, 이것만 믿고 API 검사를 빼면 안 됩니다.
 */
export function App() {
  const session = useStaffSession();

  if (session.isPending) {
    return (
      <div className="grid min-h-dvh place-items-center text-[var(--surface-muted)]">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  const user = session.data?.user;
  if (!user || !isStaff(user.platformRole)) return <SignInPage />;

  return (
    <ConsoleLayout user={user}>
      <Suspense
        fallback={
          <div className="flex justify-center py-24 text-[var(--surface-muted)]">
            <Loader2 className="size-5 animate-spin" />
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/tenants" element={<TenantsPage />} />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/audit" element={<AuditLogPage />} />
          <Route path="/announcements" element={<AnnouncementsPage />} />
          <Route path="/flags" element={<FeatureFlagsPage />} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </Suspense>
    </ConsoleLayout>
  );
}
