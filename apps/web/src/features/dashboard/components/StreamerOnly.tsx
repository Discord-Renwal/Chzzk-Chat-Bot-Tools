import { Loader2, ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState } from '@chzzk-bot/ui';

interface StreamerOnlyProps {
  isPending: boolean;
  error: Error | null;
  children: ReactNode;
}

/**
 * 치지직 서버 상태를 다루는 화면의 공통 껍데기.
 *
 * 제재 목록·채팅 설정 같은 API 는 **스트리머 계정에서만** 동작하고,
 * 그 외 계정에는 400 "스트리머가 아닙니다" 를 돌려줍니다.
 * 이걸 그냥 "오류" 로 보여주면 사용자가 무엇이 잘못됐는지 알 수 없어서,
 * 원인을 구분해 안내합니다.
 */
export function StreamerOnly({ isPending, error, children }: StreamerOnlyProps) {
  if (isPending) {
    return (
      <div className="flex items-center justify-center py-16 text-[var(--surface-muted)]">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (error) {
    const notStreamer = error.message.includes('스트리머가 아닙니다');
    return (
      <EmptyState
        icon={<ShieldAlert className="size-5" />}
        title={notStreamer ? '스트리머 계정에서만 사용할 수 있습니다' : '불러오지 못했습니다'}
      >
        {notStreamer ? (
          <>
            <p>
              이 기능은 치지직이 스트리머 계정에만 열어 둔 API 를 씁니다. 지금 로그인한 계정은
              해당하지 않아 목록을 가져올 수 없습니다.
            </p>
            <p className="mt-2">
              방송을 진행하는 채널 계정으로 <code className="text-brand">pnpm login</code> 을 다시
              실행하면 사용할 수 있습니다.
            </p>
          </>
        ) : (
          <p>{error.message}</p>
        )}
      </EmptyState>
    );
  }

  return <>{children}</>;
}
