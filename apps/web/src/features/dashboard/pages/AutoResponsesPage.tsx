import { MessagesSquare, Plus } from 'lucide-react';
import { Button, EmptyState } from '@chzzk-bot/ui';
import { PageHeader } from '../components/Layout';
import { AutoResponseCard } from '../components/AutoResponseCard';
import type { BotConfig } from '../../../shared/types';
import { useCreateAutoResponse } from '../../../shared/api/bot';

export function AutoResponsesPage({ config }: { config: BotConfig }) {
  const create = useCreateAutoResponse();

  function add() {
    create.mutate({
      label: '새 자동응답',
      pattern: '키워드',
      response: '{user}님 안녕하세요!',
    });
  }

  return (
    <>
      <PageHeader
        title="채팅 자동응답"
        description="특정 단어가 채팅에 나오면 봇이 자동으로 답합니다. 쿨다운은 채널 전체 공통이라, 여러 명이 동시에 같은 말을 해도 도배하지 않습니다."
      />

      <Button variant="primary" onClick={add} loading={create.isPending} className="mb-4">
        <Plus className="size-4" />
        자동응답 추가
      </Button>

      {config.autoResponses.length === 0 ? (
        <EmptyState icon={<MessagesSquare className="size-5" />} title="등록된 자동응답이 없습니다">
          "안녕" 처럼 자주 나오는 인사에 반응하게 해두면 채팅이 한결 살아납니다.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {config.autoResponses.map((rule) => (
            <AutoResponseCard key={rule.id} rule={rule} />
          ))}
        </div>
      )}
    </>
  );
}
