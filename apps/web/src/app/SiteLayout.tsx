import { Bot, LayoutDashboard, LogOut, Moon, Sun, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { Button, cn } from '@chzzk-bot/ui';
import { goToLogin, useLogout, useSession } from '../shared/api/session';

const NAV = [
  { to: '/features', label: '기능' },
  { to: '/pricing', label: '요금제' },
];

/** 다크/라이트 전환. 선택은 localStorage 에 남습니다. */
function ThemeToggle() {
  const [dark, setDark] = useState(() => localStorage.getItem('theme') !== 'light');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  return (
    <button
      type="button"
      onClick={() => setDark((v) => !v)}
      aria-label={dark ? '라이트 모드로 전환' : '다크 모드로 전환'}
      className={cn(
        'grid size-9 place-items-center rounded-lg text-[var(--surface-muted)]',
        'transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--surface-text)]',
        'focus-visible:focus-ring'
      )}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

/**
 * 서비스 소개와 마이페이지가 공유하는 껍데기.
 *
 * 관리자 대시보드는 이 레이아웃을 쓰지 않습니다. 그쪽은 사이드바가 있는 작업
 * 화면이라 상단 내비게이션과 목적이 다릅니다.
 */
export function SiteLayout() {
  const session = useSession();
  const logout = useLogout();
  const user = session.data?.user;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-[var(--surface-border)] bg-[var(--surface-bg)]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5 focus-visible:focus-ring">
            <div className="grid size-9 place-items-center rounded-xl bg-brand text-brand-ink">
              <Bot className="size-5" />
            </div>
            <div className="leading-tight">
              <p className="text-[15px] font-semibold">치지직 챗봇</p>
              <p className="text-[11px] text-[var(--surface-muted)]">Chzzk Bot Platform</p>
            </div>
          </Link>

          <nav className="ml-4 hidden items-center gap-1 sm:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'text-[var(--surface-text)]'
                      : 'text-[var(--surface-muted)] hover:text-[var(--surface-text)]'
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />

            {session.isPending ? null : user ? (
              <>
                <Button variant="secondary" size="sm" asChild>
                  <Link to="/dashboard/general">
                    <LayoutDashboard className="size-4" />
                    채널 관리
                  </Link>
                </Button>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/mypage">
                    <UserRound className="size-4" />
                    <span className="max-w-24 truncate">{user.channelName}</span>
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="로그아웃"
                  loading={logout.isPending}
                  onClick={() => logout.mutate()}
                >
                  <LogOut className="size-4" />
                </Button>
              </>
            ) : (
              <Button variant="primary" size="sm" onClick={() => goToLogin()}>
                치지직으로 시작하기
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-[var(--surface-border)] py-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 text-xs text-[var(--surface-muted)] sm:flex-row sm:items-center sm:px-6">
          <p>© {new Date().getFullYear()} Chzzk Bot Platform</p>
          <p className="sm:ml-auto">
            치지직은 NAVER Corp. 의 상표이며, 이 서비스는 치지직과 제휴 관계가 없습니다.
          </p>
        </div>
      </footer>
    </div>
  );
}
