import { Braces, Check, Copy, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SystemVariable, SystemVariableGroup } from '@chzzk-bot/contracts';
import { Button, Card, cn, EmptyState } from '@chzzk-bot/ui';
import { PageHeader } from '../components/Layout';
import { request } from '../../../shared/api/client';

interface VariablesResponse {
  variables: SystemVariable[];
  groupLabels: Record<SystemVariableGroup, string>;
}

/**
 * 시스템 변수 — **읽기 전용** 참조 화면.
 *
 * 목록을 서버에서 받아 옵니다. 변수는 엔진이 해석할 수 있는 것만 존재하므로
 * 사용자가 만들거나 지울 수 없고, 목록이 바뀌는 시점은 배포뿐입니다.
 * 프런트에 하드코딩해 두면 엔진에 없는 변수를 안내하게 되고, 사용자는 응답에
 * `$없는변수` 가 그대로 찍히는 걸 방송 중에 보게 됩니다.
 */
export function SystemVariablesPage() {
  const query = useQuery({
    queryKey: ['system-variables'] as const,
    queryFn: () => request<VariablesResponse>('/system/variables'),
    // 배포 전까지 바뀌지 않습니다.
    staleTime: Infinity,
  });

  const [copied, setCopied] = useState<string | null>(null);

  function copy(token: string): void {
    void navigator.clipboard.writeText(token).then(() => {
      setCopied(token);
      setTimeout(() => setCopied((current) => (current === token ? null : current)), 1500);
    });
  }

  if (query.isPending) {
    return (
      <div className="flex justify-center py-24 text-[var(--surface-muted)]">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <EmptyState icon={<Braces className="size-5" />} title="변수 목록을 불러오지 못했습니다">
        <p>{query.error?.message ?? '서버에 연결할 수 없습니다.'}</p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => void query.refetch()}>
          다시 시도
        </Button>
      </EmptyState>
    );
  }

  const { variables, groupLabels } = query.data;
  const groups = [...new Set(variables.map((v) => v.group))];

  return (
    <>
      <PageHeader
        title="시스템 변수"
        description="응답 문구에 넣으면 실제 값으로 바뀝니다. 서버가 관리하므로 추가·삭제할 수 없고, 여기 있는 이름은 전부 실제로 동작합니다."
      />

      <Card className="mb-4">
        <p className="text-sm leading-relaxed text-[var(--surface-muted)]">
          <code className="rounded bg-[var(--surface-raised)] px-1.5 py-0.5 text-brand-300">
            $닉네임
          </code>{' '}
          과{' '}
          <code className="rounded bg-[var(--surface-raised)] px-1.5 py-0.5 text-brand-300">
            {'{닉네임}'}
          </code>{' '}
          둘 다 됩니다. 모르는 이름은 바뀌지 않고 문구에 그대로 남으니, 오타는 채팅에서 바로
          드러납니다.
        </p>
      </Card>

      <div className="space-y-4">
        {groups.map((group) => (
          <Card key={group}>
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--surface-muted)]">
              {groupLabels[group] ?? group}
            </h3>

            <ul className="mt-3 divide-y divide-[var(--surface-border)]">
              {variables
                .filter((variable) => variable.group === group)
                .map((variable) => {
                  const token = `$${variable.name}`;
                  return (
                    <li key={variable.name} className="flex items-start gap-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => copy(token)}
                        title="복사"
                        className={cn(
                          'flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[13px]',
                          'bg-[var(--surface-raised)] text-brand-300 transition-colors',
                          'hover:brightness-125 focus-visible:focus-ring'
                        )}
                      >
                        {token}
                        {copied === token ? (
                          <Check className="size-3 text-brand" />
                        ) : (
                          <Copy className="size-3 opacity-50" />
                        )}
                      </button>

                      <div className="min-w-0 flex-1">
                        <p className="text-sm">{variable.description}</p>
                        <p className="mt-0.5 text-xs text-[var(--surface-muted)]">
                          예시{' '}
                          <span className="text-[var(--surface-text)]">{variable.example}</span>
                          {variable.aliases.length > 0 ? (
                            <>
                              {' · 같은 뜻 '}
                              {variable.aliases.map((alias) => `$${alias}`).join(', ')}
                            </>
                          ) : null}
                          {variable.onlyFor === 'list' ? ' · 목록형 전용' : ''}
                        </p>
                      </div>
                    </li>
                  );
                })}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
