import { useState } from 'react';
import { Plus, ShieldHalf, TerminalSquare } from 'lucide-react';
import { Button, Card, cn, EmptyState, Field, Select } from '@chzzk-bot/ui';
import { PageHeader } from '../components/Layout';
import { CommandCard } from '../components/CommandCard';
import { COMMAND_TYPES, COMMAND_TYPE_HINTS } from '../../../shared/constants';
import type {
  BotConfig,
  CommandType,
  CustomCommand,
  UserRoleCodeValue,
} from '../../../shared/types';
import { useCreateCommand } from '../../../shared/api/bot';

/** 누가 쓰는 명령인지. 사이드바가 이 값으로 두 화면을 나눕니다. */
export type CommandAudience = 'viewer' | 'admin';

const MANAGER_ROLES: UserRoleCodeValue[] = [
  'streamer',
  'streaming_channel_manager',
  'streaming_chat_manager',
];

/**
 * 시청자용인지 관리자용인지 가르는 유일한 기준.
 *
 * `useRoles` 에 일반 시청자가 들어 있으면 시청자 명령입니다. 별도 플래그를
 * 두지 않은 이유는, 플래그와 실제 권한이 어긋나는 순간 화면이 거짓말을 하기
 * 때문입니다. 권한 자체를 기준으로 삼으면 그럴 수 없습니다.
 */
export function isViewerCommand(command: CustomCommand): boolean {
  return command.useRoles.includes('common_user');
}

const COPY: Record<CommandAudience, { title: string; description: string; empty: string }> = {
  viewer: {
    title: '시청자 명령어',
    description: '시청자 누구나 채팅에서 부를 수 있는 명령입니다.',
    empty: '아직 시청자에게 열린 명령이 없습니다.',
  },
  admin: {
    title: '관리자 명령어',
    description: '스트리머와 매니저만 부를 수 있습니다. 시청자가 쳐도 반응하지 않습니다.',
    empty: '아직 관리자 전용 명령이 없습니다.',
  },
};

export function CommandsPage({
  config,
  audience,
}: {
  config: BotConfig;
  audience: CommandAudience;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<CommandType>('text');
  const create = useCreateCommand();
  const prefix = config.general.prefix;
  const copy = COPY[audience];

  const commands = config.commands.filter((command) =>
    audience === 'viewer' ? isViewerCommand(command) : !isViewerCommand(command)
  );

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    // 어느 화면에서 만들었는지가 곧 권한입니다. 관리자 목록에서 만든 명령이
    // 기본으로 전체 공개면, 만든 사람의 의도와 반대로 동작합니다.
    const useRoles: UserRoleCodeValue[] =
      audience === 'viewer' ? [...MANAGER_ROLES, 'common_user'] : [...MANAGER_ROLES];

    create.mutate({ name: trimmed, type, useRoles }, { onSuccess: () => setName('') });
  }

  return (
    <>
      <PageHeader
        title={copy.title}
        description={
          audience === 'viewer' ? (
            <>
              {copy.description} <b className="text-[var(--surface-text)]">목록형</b>을 쓰면{' '}
              <code className="rounded bg-[var(--surface-raised)] px-1.5 py-0.5 text-brand-300">
                {prefix}멤버 빅헤드,9구진
              </code>{' '}
              처럼 채팅에서 값을 등록해 두고, 나중에{' '}
              <code className="rounded bg-[var(--surface-raised)] px-1.5 py-0.5 text-brand-300">
                {prefix}멤버
              </code>{' '}
              만 쳐도 그 목록이 나옵니다.
            </>
          ) : (
            copy.description
          )
        }
      />

      <Card className="mb-4">
        {/*
          라벨 높이가 같고 힌트가 행 밖에 있으므로, 세 컨트롤의 아래선이 정확히 맞습니다.
          (예전에는 버튼에 margin 을 줘서 맞췄는데, 힌트 줄 수가 바뀌면 어긋났습니다.)
        */}
        <form onSubmit={submit} className="space-y-2.5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label="새 명령어 이름" className="flex-1">
              {/* 접두사를 입력칸 안쪽에 붙여 한 덩어리로 보이게 합니다. */}
              <div
                className={cn(
                  'flex items-center rounded-lg border border-[var(--surface-border)]',
                  'bg-[var(--surface-bg)] transition-colors',
                  'focus-within:border-brand-600 hover:border-[var(--color-ink-400)]'
                )}
              >
                <span className="pl-3 pr-0.5 font-mono text-sm text-[var(--surface-muted)]">
                  {prefix}
                </span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={audience === 'viewer' ? '멤버' : '공지'}
                  maxLength={30}
                  className={cn(
                    'h-9.5 w-full min-w-0 rounded-r-lg bg-transparent pr-3 text-sm outline-none',
                    'placeholder:text-[var(--surface-muted)]/60'
                  )}
                />
              </div>
            </Field>

            <Field label="종류" className="sm:w-44">
              <Select
                value={type}
                onValueChange={setType}
                options={COMMAND_TYPES}
                aria-label="종류"
                className="h-9.5"
              />
            </Field>

            <Button
              type="submit"
              variant="primary"
              loading={create.isPending}
              disabled={name.trim() === ''}
            >
              <Plus className="size-4" />
              추가
            </Button>
          </div>

          <p className="text-xs leading-relaxed text-[var(--surface-muted)]">
            {COMMAND_TYPE_HINTS[type]}{' '}
            {audience === 'admin'
              ? '스트리머·매니저만 쓸 수 있게 만들어집니다.'
              : '누구나 쓸 수 있게 만들어집니다.'}
          </p>
        </form>
      </Card>

      {commands.length === 0 ? (
        <EmptyState
          icon={
            audience === 'viewer' ? (
              <TerminalSquare className="size-5" />
            ) : (
              <ShieldHalf className="size-5" />
            )
          }
          title={copy.empty}
        >
          위에서 이름을 입력해 만들어 보세요. 권한은 만든 뒤에도 각 명령에서 바꿀 수 있습니다.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {commands.map((command) => (
            <CommandCard key={command.id} command={command} prefix={prefix} />
          ))}
        </div>
      )}
    </>
  );
}
