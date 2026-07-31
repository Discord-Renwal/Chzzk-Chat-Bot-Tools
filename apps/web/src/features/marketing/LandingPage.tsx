import {
  AlarmClock,
  ArrowRight,
  Coins,
  Dices,
  MessagesSquare,
  Music,
  ShieldBan,
  TerminalSquare,
} from 'lucide-react';
import { Link } from 'react-router';
import { Button, Card } from '@chzzk-bot/ui';
import { goToLogin, useSession } from '../../shared/api/session';

const HIGHLIGHTS = [
  {
    icon: TerminalSquare,
    title: '커스텀 명령어',
    body: '고정 문구·목록·카운터 세 가지로 대부분의 필요를 덮습니다. !멤버 처럼 채팅에서 바로 목록을 고칠 수도 있습니다.',
  },
  {
    icon: MessagesSquare,
    title: '자동응답',
    body: '포함·일치·시작·정규식으로 조건을 잡고, 쿨다운과 확률로 도배를 막습니다.',
  },
  {
    icon: ShieldBan,
    title: '금칙어 · 스팸 필터',
    body: '자음 연타, 같은 말 반복, 링크 도배처럼 한국 채팅에서 실제로 문제되는 패턴을 기준으로 잡았습니다.',
  },
  {
    icon: Coins,
    title: '포인트 · 출석',
    body: '채팅·후원·구독으로 쌓고 연속 출석 보너스까지. 이름은 채널에 맞게 "젤리"든 "코인"이든 바꿔 쓰세요.',
  },
  {
    icon: Dices,
    title: '미니게임',
    body: '도박·주사위·슬롯. 쌓이기만 하던 포인트에 쓸 곳을 만들어 순환을 줍니다.',
  },
  {
    icon: Music,
    title: '신청곡',
    body: '포인트로 신청받고 대기열을 관리합니다. 1인당 개수와 중복 신청을 막을 수 있습니다.',
  },
  {
    icon: AlarmClock,
    title: '주기 메시지',
    body: '시간뿐 아니라 "지난 발사 이후 채팅 N개" 조건도 봅니다. 빈 방송에 봇 혼자 떠들지 않습니다.',
  },
];

/**
 * 서비스 소개 첫 화면 (요구사항 1번의 "기능 소개").
 *
 * 로그인 버튼 하나로 시작하게 만드는 것이 목적입니다. 치지직 계정으로 바로
 * 시작하므로 별도 회원가입 단계가 없고, 그 사실을 히어로에서 분명히 말합니다.
 */
export function LandingPage() {
  const session = useSession();
  const loggedIn = Boolean(session.data);

  return (
    <div>
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-20 sm:px-6 sm:pt-28">
        <p className="text-sm font-medium text-brand">치지직 공식 API 기반</p>
        <h1 className="mt-3 max-w-2xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          방송에 필요한 챗봇,
          <br />
          설정 화면에서 5분이면 끝납니다.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-[var(--surface-muted)]">
          명령어·자동응답·금칙어·포인트·신청곡을 한 곳에서 관리하세요. 치지직 계정으로 로그인하면
          바로 시작할 수 있고, 채팅창에 <code className="text-brand">!입장</code> 만 치면 봇이
          들어옵니다.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          {loggedIn ? (
            <Button variant="primary" size="md" asChild>
              <Link to="/dashboard/general">
                채널 관리로 이동
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          ) : (
            <Button variant="primary" size="md" onClick={() => goToLogin()}>
              치지직으로 시작하기
              <ArrowRight className="size-4" />
            </Button>
          )}
          <Button variant="secondary" size="md" asChild>
            <Link to="/pricing">요금제 보기</Link>
          </Button>
        </div>

        <p className="mt-4 text-xs text-[var(--surface-muted)]">
          가입 즉시 프로 요금제를 14일간 무료로 씁니다. 카드 등록 없이 시작하세요.
        </p>
      </section>

      {/* 입장 흐름 — 이 서비스에서 가장 자주 받는 질문입니다. */}
      <section className="border-y border-[var(--surface-border)] bg-[var(--surface-raised)]/40 py-14">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-lg font-semibold">시작은 세 단계입니다</h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              {
                step: '1',
                title: '치지직으로 로그인',
                body: '채널 정보를 읽고 채팅을 보낼 권한을 승인하면 채널이 자동으로 만들어집니다.',
              },
              {
                step: '2',
                title: '명령어 등록',
                body: '예시 명령어가 이미 들어 있습니다. 필요한 것만 고쳐 쓰세요.',
              },
              {
                step: '3',
                title: '채팅에 !입장',
                body: '스트리머나 매니저가 !입장 을 치면 그때부터 봇이 응답합니다. !퇴장 으로 내보냅니다.',
              },
            ].map((item) => (
              <li key={item.step}>
                <Card className="h-full">
                  <div className="grid size-7 place-items-center rounded-lg bg-brand text-sm font-semibold text-brand-ink">
                    {item.step}
                  </div>
                  <h3 className="mt-3 font-semibold">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-[var(--surface-muted)]">
                    {item.body}
                  </p>
                </Card>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-lg font-semibold">필요한 기능은 이미 들어 있습니다</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {HIGHLIGHTS.map(({ icon: Icon, title, body }) => (
            <Card key={title} className="h-full">
              <Icon className="size-5 text-brand" />
              <h3 className="mt-3 font-semibold">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--surface-muted)]">{body}</p>
            </Card>
          ))}
        </div>

        <div className="mt-8">
          <Button variant="secondary" asChild>
            <Link to="/features">
              기능 자세히 보기
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
