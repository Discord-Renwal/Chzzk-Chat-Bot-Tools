import {
  ArrowRight,
  CreditCard,
  ExternalLink,
  LayoutDashboard,
  Radio,
  ShieldCheck,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { Badge, Button, Card, CardTitle, cn, EmptyState } from '@chzzk-bot/ui';
import { useSubscription } from '../../shared/api/billing';
import { useBotStatus } from '../../shared/api/bot';
import { useActiveTenant, useSession } from '../../shared/api/session';
import { BOT_STATUS_LABELS, SUBSCRIPTION_STATUS_LABELS } from '../../shared/types';

/**
 * 마이페이지 (요구사항 1번).
 *
 * 여기서 가장 중요한 건 **다음에 무엇을 해야 하는지** 보여주는 것입니다.
 * 봇이 아직 입장하지 않았거나 체험이 끝나가는 상태를 첫 화면에서 알려주지 않으면,
 * 사용자는 방송 직전에야 문제를 발견합니다.
 *
 * 내부 관리자에게는 콘솔 링크가 함께 보입니다 — "마이페이지 접근 시 따로 보여지는
 * 관리자 페이지" 라는 요구사항이 여기와 아래 채널 카드 두 곳에 걸쳐 있습니다.
 */
export function MyPage() {
  const session = useSession();
  const { tenant, tenants, setTenantId } = useActiveTenant();
  const subscription = useSubscription();
  const status = useBotStatus();
  const [params] = useSearchParams();

  const user = session.data?.user;
  const isStaff = user ? user.platformRole !== 'MEMBER' : false;
  const welcome = params.get('welcome') === '1';

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <header className="flex items-center gap-4">
        {user?.profileImageUrl ? (
          <img
            src={user.profileImageUrl}
            alt=""
            className="size-14 rounded-full border border-[var(--surface-border)] object-cover"
          />
        ) : (
          <div className="size-14 rounded-full bg-[var(--surface-raised)]" />
        )}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight">{user?.channelName}</h1>
          <p className="truncate font-mono text-xs text-[var(--surface-muted)]">
            {user?.chzzkChannelId}
          </p>
        </div>
      </header>

      {welcome ? (
        <Card className="mt-6 border-brand/40 bg-brand/5">
          <CardTitle>가입을 환영합니다</CardTitle>
          <p className="mt-1 text-sm leading-relaxed text-[var(--surface-muted)]">
            채널이 만들어졌고 예시 명령어가 들어 있습니다. 프로 요금제를 14일간 무료로 쓸 수
            있습니다. 채널 관리에서 명령어를 확인한 뒤, 방송 채팅에{' '}
            <code className="text-brand">!입장</code> 을 입력하면 봇이 들어옵니다.
          </p>
          <Button size="sm" className="mt-4" asChild>
            <Link to="/dashboard/general">
              채널 관리 시작하기
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </Card>
      ) : null}

      {isStaff ? (
        <Card className="mt-6 border-amber-500/30 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-amber-400" />
            <div className="min-w-0 flex-1">
              <CardTitle>내부 관리자 계정</CardTitle>
              <p className="mt-1 text-sm text-[var(--surface-muted)]">
                이 계정은 <b>{user?.platformRole}</b> 권한을 갖고 있습니다. 사용자·구독·봇 상태
                관리는 별도 콘솔에서 합니다.
              </p>
            </div>
            <Button variant="secondary" size="sm" asChild>
              <a href={backofficeUrl()} target="_blank" rel="noreferrer">
                관리자 콘솔
                <ExternalLink className="size-4" />
              </a>
            </Button>
          </div>
        </Card>
      ) : null}

      {/* ─── 내 채널 ─── */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--surface-muted)]">
          내 채널
        </h2>

        {tenants.length === 0 ? (
          <Card className="mt-3">
            <EmptyState title="채널이 없습니다">
              <p>치지직 계정으로 다시 로그인하면 채널이 만들어집니다.</p>
            </EmptyState>
          </Card>
        ) : (
          <div className="mt-3 space-y-3">
            {tenants.map((item) => {
              const active = item.id === tenant?.id;
              return (
                <Card
                  key={item.id}
                  className={cn('transition-colors', active && 'ring-1 ring-brand')}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{item.channelName}</p>
                      <p className="mt-0.5 text-xs text-[var(--surface-muted)]">
                        /{item.slug} · {item.role === 'OWNER' ? '스트리머' : '매니저'}
                      </p>
                    </div>

                    {active ? (
                      <Badge>선택됨</Badge>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => setTenantId(item.id)}>
                        이 채널 보기
                      </Button>
                    )}

                    <Button variant="secondary" size="sm" asChild>
                      <Link to="/dashboard/general" onClick={() => setTenantId(item.id)}>
                        <LayoutDashboard className="size-4" />
                        관리
                      </Link>
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ─── 봇 상태 · 구독 ─── */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Card>
          <div className="flex items-center gap-2">
            <Radio className="size-4 text-brand" />
            <CardTitle>봇 상태</CardTitle>
          </div>

          {status.data?.instance ? (
            <>
              <p className="mt-3 text-lg font-semibold">
                {BOT_STATUS_LABELS[status.data.instance.status]}
              </p>
              {status.data.instance.status === 'IDLE' ? (
                <p className="mt-1 text-sm leading-relaxed text-[var(--surface-muted)]">
                  연결은 됐지만 아직 방에 들어가지 않았습니다. 채팅에{' '}
                  <code className="text-brand">!입장</code> 을 입력하거나 채널 관리에서 버튼을
                  누르세요.
                </p>
              ) : null}
              {status.data.instance.lastError ? (
                <p className="mt-1 text-sm text-red-400">{status.data.instance.lastError}</p>
              ) : null}
            </>
          ) : (
            <p className="mt-3 text-sm text-[var(--surface-muted)]">
              아직 봇이 실행된 적이 없습니다.
            </p>
          )}
        </Card>

        <Card>
          <div className="flex items-center gap-2">
            <CreditCard className="size-4 text-brand" />
            <CardTitle>요금제</CardTitle>
          </div>

          {subscription.data ? (
            <>
              <p className="mt-3 text-lg font-semibold">{subscription.data.plan.name}</p>
              <p className="mt-1 text-sm text-[var(--surface-muted)]">
                {SUBSCRIPTION_STATUS_LABELS[subscription.data.status]} ·{' '}
                {formatDate(subscription.data.currentPeriodEnd)}까지
              </p>
              <div className="mt-4 flex gap-2">
                <Button variant="secondary" size="sm" asChild>
                  <Link to="/mypage/plan">요금제 변경</Link>
                </Button>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/mypage/billing">결제 내역</Link>
                </Button>
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-[var(--surface-muted)]">구독 정보를 불러오는 중…</p>
          )}
        </Card>
      </div>
    </div>
  );
}

/**
 * 관리자 콘솔 주소.
 *
 * 빌드 시 주입된 값을 쓰되, 없으면 로컬 개발 포트로 넘어갑니다. 이 링크가
 * 잘못돼도 일반 사용자에게는 보이지 않으므로 실패해도 영향 범위가 좁습니다.
 */
function backofficeUrl(): string {
  const configured: unknown = import.meta.env.VITE_BACKOFFICE_URL;
  return typeof configured === 'string' && configured ? configured : 'http://localhost:5174';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
