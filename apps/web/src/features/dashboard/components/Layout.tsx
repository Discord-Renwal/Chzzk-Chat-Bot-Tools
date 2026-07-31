import * as Tooltip from '@radix-ui/react-tooltip';
import { ChevronRight, Power } from 'lucide-react';
import { motion } from 'motion/react';
import { Link, NavLink, useLocation } from 'react-router';
import { useMemo, type ReactNode } from 'react';
import { cn, Select } from '@chzzk-bot/ui';
import { NAV_GROUPS, ROUTES } from '../routes';
import { useSetJoined, useStartBot } from '../../../shared/api/bot';
import { useActiveTenant } from '../../../shared/api/session';
import { BOT_STATUS_LABELS, type StatusResponse } from '../../../shared/types';

/** 크롬(사이드바·헤더) 위에 얹는 툴팁 — 배경이 어두워 기본 패널 색과 맞지 않습니다. */
const TOOLTIP_CLASS = cn(
  'z-50 max-w-xs rounded-lg border px-3 py-2 text-xs shadow-xl',
  'border-[var(--chrome-border)] bg-[var(--chrome-bg)] text-[var(--chrome-text)]'
);

/**
 * 라이브 상태 표시 + 전원.
 *
 * 헤더 오른쪽에는 이 두 가지만 둡니다. 예전에는 상태 배지·입장·퇴장·중지가
 * 따로 있었는데, 넷 다 "봇을 켜고 끈다" 는 한 가지 의도의 변형이라 오히려
 * 무엇을 눌러야 할지 헷갈렸습니다.
 *
 * 전원 하나가 상태에 따라 다음 동작을 합니다.
 *   STOPPED · ERROR → 봇 시작
 *   IDLE            → 입장 (채팅의 `!입장` 과 같은 동작)
 *   JOINED          → 퇴장
 */
function LiveControl({ status }: { status: StatusResponse | undefined }) {
  const setJoined = useSetJoined();
  const startBot = useStartBot();

  const state = status?.instance?.status ?? 'STOPPED';
  const joined = state === 'JOINED';
  const connected = state === 'IDLE' || state === 'JOINED';
  const busy = setJoined.isPending || startBot.isPending;

  const dot = joined
    ? 'bg-brand'
    : state === 'ERROR'
      ? 'bg-red-500'
      : connected
        ? 'bg-amber-400'
        : 'bg-[#6f7375]';

  const action = joined ? '퇴장시키기' : connected ? '입장시키기' : '봇 시작';

  return (
    <div className="flex items-center gap-2">
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <div
            className={cn(
              'flex items-center gap-2 rounded-md border px-2.5 py-1.5',
              'border-[var(--chrome-border)] text-[13px] text-[var(--chrome-text)]'
            )}
          >
            <span className="relative flex size-2">
              {joined ? (
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
              ) : null}
              <span className={cn('relative inline-flex size-2 rounded-full', dot)} />
            </span>
            <span className="font-medium">Live</span>
            <span className="opacity-60">{BOT_STATUS_LABELS[state]}</span>
          </div>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content sideOffset={8} className={TOOLTIP_CLASS}>
            {status?.instance?.lastError ? (
              <p className="text-red-400">{status.instance.lastError}</p>
            ) : state === 'IDLE' ? (
              <p>
                연결됐지만 아직 입장하지 않았습니다. 채팅에 <code>!입장</code> 을 입력하거나 옆 전원
                버튼을 누르세요.
              </p>
            ) : state === 'JOINED' ? (
              <p>
                {status?.instance?.joinedBy
                  ? `${status.instance.joinedBy}님이 입장시켰습니다.`
                  : '입장 중'}
              </p>
            ) : (
              <p>봇이 꺼져 있습니다.</p>
            )}
            <Tooltip.Arrow className="fill-[var(--chrome-border)]" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>

      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            aria-label={action}
            disabled={busy}
            onClick={() => (connected ? setJoined.mutate(!joined) : startBot.mutate())}
            className={cn(
              'grid size-9 shrink-0 place-items-center rounded-md border transition-colors',
              'cursor-pointer focus-visible:focus-ring disabled:opacity-50',
              joined
                ? 'border-brand-600/50 bg-brand/15 text-brand'
                : 'border-[var(--chrome-border)] text-[var(--chrome-text)] hover:bg-[var(--chrome-active)]'
            )}
          >
            <Power className={cn('size-4', busy && 'animate-pulse')} />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content sideOffset={8} className={TOOLTIP_CLASS}>
            {action}
            <Tooltip.Arrow className="fill-[var(--chrome-border)]" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </div>
  );
}

/**
 * 진입 뎁스 표기.
 *
 * `채널 / 그룹 / 화면` 세 단계입니다. 첫 조각이 채널 선택기를 겸합니다 —
 * 어차피 "지금 어느 채널을 보고 있는가" 가 뎁스의 첫 칸이고, 그 자리에서 바로
 * 바꿀 수 있어야 채널을 여럿 가진 사람이 헤매지 않습니다.
 */
function Breadcrumb() {
  const { tenant, tenants, setTenantId } = useActiveTenant();
  const location = useLocation();

  const options = useMemo(() => tenants.map((t) => [t.id, t.channelName] as const), [tenants]);

  // `/dashboard/commands/viewer` → `commands/viewer`
  const path = location.pathname.replace(/^\/dashboard\/?/, '');
  const current = ROUTES.find((route) => route.path === path);

  return (
    <nav aria-label="현재 위치" className="flex min-w-0 items-center gap-1.5 text-sm">
      {tenants.length > 1 ? (
        <Select
          aria-label="채널 선택"
          value={tenant?.id ?? ''}
          onValueChange={setTenantId}
          options={options}
          className="h-8 w-44 shrink-0 border-[var(--chrome-border)] bg-transparent text-[var(--chrome-text)]"
        />
      ) : (
        <Link
          to="/mypage"
          className="shrink-0 truncate rounded px-1 font-medium text-[var(--chrome-text)] hover:underline focus-visible:focus-ring"
        >
          {tenant?.channelName ?? '채널'}
        </Link>
      )}

      {current ? (
        <>
          <ChevronRight className="size-3.5 shrink-0 text-[var(--chrome-text)] opacity-40" />
          <span className="shrink-0 text-[var(--chrome-text)] opacity-60">{current.group}</span>
          <ChevronRight className="size-3.5 shrink-0 text-[var(--chrome-text)] opacity-40" />
          <span className="truncate font-medium text-[var(--chrome-text)]">{current.label}</span>
        </>
      ) : null}
    </nav>
  );
}

interface LayoutProps {
  status: StatusResponse | undefined;
  children: ReactNode;
}

export function DashboardLayout({ status, children }: LayoutProps) {
  const location = useLocation();

  return (
    <div className="dashboard-shell flex min-h-dvh">
      {/* ─── 사이드바 ─── */}
      <aside
        className={cn(
          'hidden w-56 shrink-0 flex-col border-r lg:flex',
          'border-[var(--chrome-border)] bg-[var(--chrome-bg)]'
        )}
      >
        <div className="flex h-14 shrink-0 items-center border-b border-[var(--chrome-border)] px-4">
          <Link
            to="/mypage"
            className="text-[15px] font-semibold text-[var(--chrome-text)] focus-visible:focus-ring"
          >
            채널 관리
          </Link>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto p-3">
          {NAV_GROUPS.map((group) => (
            <div key={group} className="space-y-0.5">
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--chrome-text)] opacity-50">
                {group}
              </p>
              {ROUTES.filter((r) => r.group === group).map(({ path, label, icon: Icon }) => (
                <NavLink
                  key={path}
                  to={`/dashboard/${path}`}
                  className={({ isActive }) =>
                    cn(
                      'relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm',
                      'transition-colors focus-visible:focus-ring',
                      isActive
                        ? 'font-medium text-white'
                        : 'text-[var(--chrome-text)] hover:bg-[var(--chrome-active)]'
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive ? (
                        <motion.span
                          layoutId="nav-active"
                          className="absolute inset-0 rounded-md bg-[var(--chrome-active)] ring-1 ring-inset ring-[var(--chrome-border)]"
                          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                        />
                      ) : null}
                      {isActive ? (
                        <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-brand" />
                      ) : null}
                      <Icon className="relative size-4 shrink-0" />
                      <span className="relative flex-1 truncate">{label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ─── 헤더 ─── */}
        <header
          className={cn(
            'sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b px-4',
            'border-[var(--chrome-border)] bg-[var(--chrome-bg)]'
          )}
        >
          <Breadcrumb />
          <div className="ml-auto">
            <LiveControl status={status} />
          </div>
        </header>

        {/* 좁은 화면에서는 사이드바 대신 가로 스크롤 탭 */}
        <nav className="flex gap-1 overflow-x-auto border-b border-[var(--chrome-border)] bg-[var(--chrome-bg)] px-3 py-2 lg:hidden">
          {ROUTES.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={`/dashboard/${path}`}
              className={({ isActive }) =>
                cn(
                  'flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px]',
                  isActive
                    ? 'bg-[var(--chrome-active)] font-medium text-white'
                    : 'text-[var(--chrome-text)] hover:bg-[var(--chrome-active)]'
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* ─── 메인 작업 영역 ─── */}
        <motion.main
          key={location.pathname}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="min-w-0 flex-1 bg-[var(--workspace-bg)] px-4 py-6 sm:px-6"
        >
          <div className="mx-auto max-w-4xl">{children}</div>
        </motion.main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm leading-relaxed text-[var(--surface-muted)]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
