import { Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { Loader2, PlugZap } from 'lucide-react';
import { Button, EmptyState } from '@chzzk-bot/ui';
import { DashboardLayout } from './components/Layout';
import { ROUTES } from './routes';
import { useBotStatus, useConfig } from '../../shared/api/bot';
import { useActiveTenant } from '../../shared/api/session';

/**
 * 채널 관리자 화면 (요구사항 2번).
 *
 * 마이페이지에서 "관리" 를 누르면 들어옵니다. 여기부터는 한 채널의 설정만
 * 다루므로, 지금 어떤 채널을 보고 있는지가 항상 화면에 떠 있어야 합니다
 * (`DashboardLayout` 의 채널 선택기).
 */
export function DashboardApp() {
  const { tenant } = useActiveTenant();
  const config = useConfig();
  const status = useBotStatus();
  const stats = status.data?.stats ?? null;

  if (!tenant) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20">
        <EmptyState icon={<PlugZap className="size-5" />} title="관리할 채널이 없습니다">
          <p>치지직 계정으로 다시 로그인하면 채널이 만들어집니다.</p>
          <Button variant="secondary" size="sm" className="mt-4" asChild>
            <a href="/mypage">마이페이지로</a>
          </Button>
        </EmptyState>
      </div>
    );
  }

  return (
    <DashboardLayout status={status.data}>
      {/* lazy 로 불러오는 동안 보여줄 자리 */}
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/" element={<Navigate to="general" replace />} />
          {/* 명령어를 둘로 나누기 전 주소. 북마크가 깨지지 않게 넘겨 줍니다. */}
          <Route path="commands" element={<Navigate to="/dashboard/commands/viewer" replace />} />

          {ROUTES.map((route) => (
            <Route
              key={route.path}
              path={route.path}
              element={
                route.standalone ? (
                  // 설정이 필요 없는 화면은 곧바로 그립니다.
                  route.render({ config: undefined as never, stats })
                ) : (
                  <ConfigGate config={config}>
                    {(loaded) => route.render({ config: loaded, stats })}
                  </ConfigGate>
                )
              }
            />
          ))}

          <Route
            path="*"
            element={
              <EmptyState icon={<PlugZap className="size-5" />} title="없는 화면입니다">
                <p>주소를 확인해 주세요.</p>
                <Button variant="secondary" size="sm" className="mt-4" asChild>
                  <a href="/dashboard/general">일반 화면으로</a>
                </Button>
              </EmptyState>
            }
          />
        </Routes>
      </Suspense>
    </DashboardLayout>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-24 text-[var(--surface-muted)]">
      <Loader2 className="size-5 animate-spin" />
    </div>
  );
}

/**
 * 설정을 다 받은 뒤에 페이지를 그립니다.
 *
 * 페이지마다 "설정이 아직 없을 때" 를 따로 처리하면 같은 코드가 열 번 반복됩니다.
 * 한 곳에서 막고, 실패했을 때 무엇을 해야 하는지도 여기서만 안내합니다.
 */
function ConfigGate({
  config,
  children,
}: {
  config: ReturnType<typeof useConfig>;
  children: (config: NonNullable<ReturnType<typeof useConfig>['data']>) => ReactNode;
}) {
  if (config.isPending) return <Spinner />;

  if (config.isError || !config.data) {
    return (
      <EmptyState icon={<PlugZap className="size-5" />} title="설정을 불러오지 못했습니다">
        <p>{config.error?.message ?? '서버에 연결할 수 없습니다.'}</p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={() => void config.refetch()}
        >
          다시 시도
        </Button>
      </EmptyState>
    );
  }

  return <>{children(config.data)}</>;
}
