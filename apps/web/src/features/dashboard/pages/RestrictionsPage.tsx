import { useState } from 'react';
import { Gavel, Plus, ShieldCheck, Undo2 } from 'lucide-react';
import { Button, Card, CardTitle, ConfirmDialog, EmptyState, Field, Input } from '@chzzk-bot/ui';
import { PageHeader } from '../components/Layout';
import { StreamerOnly } from '../components/StreamerOnly';
import {
  useRestrict,
  useRestrictions,
  useTemporaryUnrestrict,
  useUnrestrict,
} from '../../../shared/api/bot';
import type { RestrictedChannel } from '../../../shared/types';

export function RestrictionsPage() {
  const restrictions = useRestrictions();
  const unrestrict = useUnrestrict();
  const tempUnrestrict = useTemporaryUnrestrict();
  const restrict = useRestrict();

  const [targetId, setTargetId] = useState('');
  const [confirm, setConfirm] = useState<RestrictedChannel | null>(null);

  return (
    <>
      <PageHeader
        title="제재 관리"
        description="활동 제한 목록을 보고 해제합니다. 채팅에서는 !밴 · !밴해제 · !타임아웃 · !타임아웃해제 로도 조작할 수 있습니다."
      />

      <StreamerOnly isPending={restrictions.isPending} error={restrictions.error}>
        <Card className="mb-4">
          <CardTitle hint="닉네임이 아니라 채널 ID 입니다. 제한된 사람은 채팅을 못 해 닉네임으로 찾을 수 없기 때문입니다.">
            채널 ID로 활동 제한
          </CardTitle>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const id = targetId.trim();
              if (id) restrict.mutate(id, { onSuccess: () => setTargetId('') });
            }}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <Field label="대상 채널 ID" className="flex-1">
              <Input
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                placeholder="78bb78aeed19a0d610758e07a0b0bcf6"
                className="font-mono"
              />
            </Field>
            <Button
              type="submit"
              variant="primary"
              loading={restrict.isPending}
              disabled={targetId.trim() === ''}
            >
              <Plus className="size-4" />
              제한 추가
            </Button>
          </form>
        </Card>

        {(restrictions.data?.data.length ?? 0) === 0 ? (
          <EmptyState
            icon={<ShieldCheck className="size-5" />}
            title="활동 제한된 사용자가 없습니다"
          >
            깨끗한 상태입니다.
          </EmptyState>
        ) : (
          <Card className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="border-b border-[var(--surface-border)] text-left text-xs text-[var(--surface-muted)]">
                    <th className="px-4 py-2.5 font-medium">닉네임</th>
                    <th className="px-4 py-2.5 font-medium">제한 일자</th>
                    <th className="px-4 py-2.5 font-medium">해제 예정</th>
                    <th className="px-4 py-2.5 text-right font-medium">해제</th>
                  </tr>
                </thead>
                <tbody>
                  {restrictions.data?.data.map((row) => (
                    <tr
                      key={row.restrictedChannelId}
                      className="border-b border-[var(--surface-border)]/60 last:border-0"
                    >
                      <td className="px-4 py-2.5">
                        <p className="font-medium">{row.restrictedChannelName || '알 수 없음'}</p>
                        <p className="truncate font-mono text-[11px] text-[var(--surface-muted)]">
                          {row.restrictedChannelId}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--surface-muted)]">
                        {formatDate(row.createdDate)}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--surface-muted)]">
                        {formatDate(row.releaseDate) || '영구'}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => tempUnrestrict.mutate(row.restrictedChannelId)}
                          >
                            임시제한 해제
                          </Button>
                          <Button variant="danger" size="sm" onClick={() => setConfirm(row)}>
                            <Undo2 className="size-3.5" />
                            제한 해제
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-[var(--surface-muted)]">
          <Gavel className="mt-0.5 size-3.5 shrink-0" />
          임시 제한 해제는 채팅 채널 ID 가 필요해서, 봇이 채팅을 한 번이라도 받은 뒤에 동작합니다.
          방송 시작 직후라면 잠시 기다렸다 시도하세요.
        </p>
      </StreamerOnly>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="활동 제한을 해제할까요?"
        description={confirm?.restrictedChannelName}
        confirmLabel="해제"
        onConfirm={() => confirm && unrestrict.mutate(confirm.restrictedChannelId)}
      />
    </>
  );
}

function formatDate(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
}
