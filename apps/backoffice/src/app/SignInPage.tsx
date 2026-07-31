import { Wrench } from 'lucide-react';
import { Button, Card } from '@chzzk-bot/ui';

/**
 * 콘솔 로그인.
 *
 * "권한이 없습니다" 와 "로그인이 필요합니다" 를 구분하지 않습니다. 일반 사용자가
 * 주소를 알아내 들어왔을 때, 자기 계정이 유효하다는 사실조차 알려주지 않는 편이
 * 낫습니다. 서버도 같은 이유로 403 대신 404 를 줍니다.
 */
export function SignInPage() {
  return (
    <div className="mx-auto grid min-h-dvh max-w-md place-items-center px-4">
      <Card className="w-full text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-amber-500 text-[#231a04]">
          <Wrench className="size-6" />
        </div>

        <h1 className="mt-5 text-xl font-semibold">운영 콘솔</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--surface-muted)]">
          내부 관리자 계정으로 로그인해 주세요.
        </p>

        <Button
          className="mt-6 w-full"
          onClick={() => {
            window.location.href = '/api/auth/login';
          }}
        >
          치지직으로 로그인
        </Button>
      </Card>
    </div>
  );
}
