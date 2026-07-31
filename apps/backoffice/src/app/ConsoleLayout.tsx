import {
  Building2,
  CreditCard,
  Flag,
  LayoutDashboard,
  LogOut,
  Megaphone,
  ScrollText,
  Users,
  Wrench,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { PLATFORM_ROLE_LABELS, type UserProfile } from '@chzzk-bot/contracts';
import { Button, cn } from '@chzzk-bot/ui';
import { useLogout } from '../shared/api';

const NAV = [
  { to: '/overview', label: '개요', icon: LayoutDashboard },
  { to: '/users', label: '사용자', icon: Users },
  { to: '/tenants', label: '채널', icon: Building2 },
  { to: '/payments', label: '결제', icon: CreditCard },
  { to: '/audit', label: '감사 로그', icon: ScrollText },
  { to: '/announcements', label: '공지', icon: Megaphone },
  { to: '/flags', label: '기능 플래그', icon: Flag },
];

/**
 * 콘솔 껍데기.
 *
 * 사용자 웹과 색을 일부러 다르게(호박색 강조) 씁니다. 두 화면을 동시에 열어
 * 두고 일하다 보면 어느 쪽에서 버튼을 누르는지 헷갈리는데, 여기서의 실수는
 * 남의 계정에 영향을 줍니다.
 */
export function ConsoleLayout({ user, children }: { user: UserProfile; children: ReactNode }) {
  const logout = useLogout();

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-amber-500/20 bg-[var(--surface-bg)]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <div className="grid size-9 place-items-center rounded-xl bg-amber-500 text-[#231a04]">
            <Wrench className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-tight">운영 콘솔</p>
            <p className="text-xs text-[var(--surface-muted)]">내부 관리자 전용</p>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div className="text-right">
              <p className="truncate text-sm font-medium">{user.channelName}</p>
              <p className="text-xs text-amber-400">{PLATFORM_ROLE_LABELS[user.platformRole]}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="로그아웃"
              loading={logout.isPending}
              onClick={() => logout.mutate()}
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6 sm:px-6">
        <nav className="hidden w-48 shrink-0 md:block">
          <div className="sticky top-24 space-y-0.5">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                    'focus-visible:focus-ring',
                    isActive
                      ? 'bg-amber-500/15 font-medium text-amber-300'
                      : 'text-[var(--surface-muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--surface-text)]'
                  )
                }
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </NavLink>
            ))}
          </div>
        </nav>

        <div className="min-w-0 flex-1">
          <nav className="mb-5 flex gap-1 overflow-x-auto pb-1 md:hidden">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium',
                    isActive
                      ? 'bg-amber-500/15 text-amber-300'
                      : 'text-[var(--surface-muted)] hover:bg-[var(--surface-raised)]'
                  )
                }
              >
                <Icon className="size-4" />
                {label}
              </NavLink>
            ))}
          </nav>

          <main>{children}</main>
        </div>
      </div>
    </div>
  );
}

export function PageHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {description ? (
        <p className="mt-1 text-sm leading-relaxed text-[var(--surface-muted)]">{description}</p>
      ) : null}
    </div>
  );
}
