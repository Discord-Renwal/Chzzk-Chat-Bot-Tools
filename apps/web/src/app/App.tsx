import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { Loader2 } from 'lucide-react';
import { RequireAuth } from './RequireAuth';
import { SiteLayout } from './SiteLayout';

/*
 * 화면 묶음을 세 갈래로 나눕니다.
 *
 *   marketing  — 로그인 없이 볼 수 있는 소개·요금제 (요구사항 1의 "기능 소개")
 *   account    — 마이페이지·결제 (요구사항 1의 "결제·마이페이지")
 *   dashboard  — 채널 관리자 화면 (요구사항 2)
 *
 * 세 묶음은 서로 다른 사람이 다른 시점에 보므로 번들도 따로 쪼갭니다. 요금제만
 * 보러 온 방문자가 대시보드 코드까지 받을 이유가 없습니다.
 */
const LandingPage = lazy(() =>
  import('../features/marketing/LandingPage').then((m) => ({ default: m.LandingPage }))
);
const FeaturesPage = lazy(() =>
  import('../features/marketing/FeaturesPage').then((m) => ({ default: m.FeaturesPage }))
);
const PricingPage = lazy(() =>
  import('../features/marketing/PricingPage').then((m) => ({ default: m.PricingPage }))
);
const LoginPage = lazy(() =>
  import('../features/marketing/LoginPage').then((m) => ({ default: m.LoginPage }))
);
const MyPage = lazy(() =>
  import('../features/account/MyPage').then((m) => ({ default: m.MyPage }))
);
const PlanPage = lazy(() =>
  import('../features/account/PlanPage').then((m) => ({ default: m.PlanPage }))
);
const BillingPage = lazy(() =>
  import('../features/account/BillingPage').then((m) => ({ default: m.BillingPage }))
);
const DashboardApp = lazy(() =>
  import('../features/dashboard/DashboardApp').then((m) => ({ default: m.DashboardApp }))
);

export function App() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        {/* 공개 — 로그인 없이 */}
        <Route element={<SiteLayout />}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/features" element={<FeaturesPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/login" element={<LoginPage />} />
        </Route>

        {/* 마이페이지 — 로그인 필요 */}
        <Route element={<RequireAuth />}>
          <Route element={<SiteLayout />}>
            <Route path="/mypage" element={<MyPage />} />
            <Route path="/mypage/plan" element={<PlanPage />} />
            <Route path="/mypage/billing" element={<BillingPage />} />
          </Route>

          {/*
           * 채널 관리자 화면.
           *
           * 하위 경로를 통째로 넘깁니다. 대시보드는 자기만의 사이드바와 라우트
           * 목록을 갖고 있어서, 여기서 하나하나 나열하면 화면을 추가할 때마다
           * 두 곳을 고쳐야 합니다.
           */}
          <Route path="/dashboard/*" element={<DashboardApp />} />
        </Route>

        {/* 예전 주소 호환 — 단일 채널 시절에는 대시보드가 최상위에 있었습니다. */}
        <Route path="/general" element={<Navigate to="/dashboard/general" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export function FullPageSpinner() {
  return (
    <div className="grid min-h-dvh place-items-center text-[var(--surface-muted)]">
      <Loader2 className="size-6 animate-spin" />
    </div>
  );
}
