import { Bot } from 'lucide-react';
import { Navigate, useSearchParams } from 'react-router';
import { Button, Card } from '@chzzk-bot/ui';
import { goToLogin, useSession } from '../../shared/api/session';

/** 콜백이 실패했을 때 붙여 보내는 코드 → 사람이 읽을 문장. */
const ERROR_MESSAGES: Record<string, string> = {
  missing_code: '치지직에서 인가 코드를 받지 못했습니다. 다시 시도해 주세요.',
  state_mismatch:
    '보안 검증에 실패했습니다. 브라우저를 새로 열고 다시 시도해 주세요. (쿠키 차단 설정일 수 있습니다)',
  login_failed: '로그인 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
  access_denied: '치지직에서 권한 승인을 취소하셨습니다.',
};

export function LoginPage() {
  const session = useSession();
  const [params] = useSearchParams();

  const error = params.get('error');
  const returnTo = params.get('returnTo');

  // 이미 로그인돼 있으면 원래 가려던 곳으로 보냅니다.
  if (session.data) return <Navigate to={returnTo ?? '/mypage'} replace />;

  return (
    <div className="mx-auto grid max-w-md px-4 py-20">
      <Card className="text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-brand text-brand-ink">
          <Bot className="size-6" />
        </div>

        <h1 className="mt-5 text-xl font-semibold">치지직 계정으로 시작하기</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--surface-muted)]">
          별도 회원가입이 없습니다. 치지직 계정으로 로그인하면 채널이 자동으로 만들어지고, 프로
          요금제를 14일간 무료로 쓸 수 있습니다.
        </p>

        {error ? (
          <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {ERROR_MESSAGES[error] ?? '로그인에 실패했습니다. 다시 시도해 주세요.'}
          </p>
        ) : null}

        <Button
          variant="primary"
          className="mt-6 w-full"
          onClick={() => goToLogin(returnTo ?? undefined)}
        >
          치지직으로 로그인
        </Button>

        <p className="mt-4 text-xs leading-relaxed text-[var(--surface-muted)]">
          로그인하면 채널 정보 조회와 채팅 메시지 전송 권한을 요청합니다. 이 권한은 봇이 동작하는 데
          필요하며, 치지직 설정에서 언제든 해제할 수 있습니다.
        </p>
      </Card>
    </div>
  );
}
