import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Card, Field, Input } from '@chzzk-bot/ui';
import { PageHeader } from '../app/ConsoleLayout';
import { Pagination } from '../components/Pagination';
import { useAuditLogs } from '../shared/api';

/**
 * 감사 로그 (요구사항 3번).
 *
 * 조회 전용입니다. 수정·삭제 기능은 만들지 않습니다 — 고칠 수 있는 기록은
 * 증거로 쓸 수 없습니다. 서버 리포지토리에도 delete 메서드가 없습니다.
 */
export function AuditLogPage() {
  const [action, setAction] = useState('');
  const [actorId, setActorId] = useState('');
  const [page, setPage] = useState(1);

  const logs = useAuditLogs({ action, actorId, page });

  return (
    <div>
      <PageHeader
        title="감사 로그"
        description="관리 동작과 결제 변경이 모두 남습니다. 수정하거나 지울 수 없습니다."
      />

      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="동작" hint="접두사로 찾습니다. 예: admin.user">
            <Input
              value={action}
              onChange={(event) => {
                setAction(event.target.value);
                setPage(1);
              }}
              placeholder="admin.user.suspend"
            />
          </Field>
          <Field label="실행자 ID">
            <Input
              value={actorId}
              onChange={(event) => {
                setActorId(event.target.value);
                setPage(1);
              }}
              placeholder="cuid"
            />
          </Field>
        </div>
      </Card>

      <Card className="mt-4">
        {logs.isPending ? (
          <div className="flex justify-center py-12 text-[var(--surface-muted)]">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : logs.isError ? (
          <p className="py-8 text-center text-sm text-red-400">{logs.error.message}</p>
        ) : (
          <>
            <ul className="divide-y divide-[var(--surface-border)]/50">
              {logs.data?.data.map((log) => (
                <li key={log.id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <code className="rounded bg-[var(--surface-raised)] px-1.5 py-0.5 text-[12px] text-amber-300">
                      {log.action}
                    </code>
                    <span className="text-[var(--surface-muted)]">
                      {log.actorName ?? log.actorType}
                    </span>
                    <span className="ml-auto text-xs text-[var(--surface-muted)]">
                      {new Date(log.createdAt).toLocaleString('ko-KR')}
                    </span>
                  </div>

                  {log.reason ? <p className="mt-1">{log.reason}</p> : null}

                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-[var(--surface-muted)]">
                    {log.targetType ? (
                      <span>
                        대상 {log.targetType} · {log.targetId}
                      </span>
                    ) : null}
                    {log.ip ? <span>IP {log.ip}</span> : null}
                    {log.metadata ? <span>{JSON.stringify(log.metadata)}</span> : null}
                  </div>
                </li>
              ))}
            </ul>

            {logs.data ? (
              <Pagination
                page={logs.data.page}
                totalPages={logs.data.totalPages}
                total={logs.data.total}
                onChange={setPage}
              />
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}
