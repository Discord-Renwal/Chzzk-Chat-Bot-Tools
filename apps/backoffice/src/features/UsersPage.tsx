import { Loader2, Search, ShieldCheck, ShieldOff } from 'lucide-react';
import { useState } from 'react';
import {
  PLATFORM_ROLE_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  platformRole as platformRoleSchema,
  type AdminUserRow,
  type PlatformRole,
} from '@chzzk-bot/contracts';
import { Badge, Button, Card, Field, Input, Select, Switch, Textarea } from '@chzzk-bot/ui';
import { PageHeader } from '../app/ConsoleLayout';
import { Pagination } from '../components/Pagination';
import { useChangeRole, useReinstateUser, useSuspendUser, useUsers } from '../shared/api';

const STATUS_OPTIONS = [
  ['', '전체 상태'],
  ['ACTIVE', '정상'],
  ['SUSPENDED', '정지됨'],
] as const;

/**
 * 사용자 관리 (요구사항 3번).
 *
 * 정지·권한 변경은 **사유 없이 실행할 수 없습니다**. 버튼을 누르는 순간 남의
 * 계정이 막히는데, 나중에 "왜 막혔나" 를 아무도 설명할 수 없으면 그 기능은
 * 없는 것만 못합니다. 사유는 감사 로그에 그대로 남습니다.
 */
export function UsersPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<AdminUserRow | null>(null);

  const users = useUsers({ q, status: status || undefined, page });

  return (
    <div>
      <PageHeader title="사용자" description="채널명 · 채널 ID · 이메일로 찾을 수 있습니다." />

      <Card>
        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--surface-muted)]" />
            <Input
              value={q}
              onChange={(event) => {
                setQ(event.target.value);
                setPage(1);
              }}
              placeholder="채널명 또는 채널 ID"
              className="pl-9"
            />
          </div>
          <Select
            aria-label="상태 필터"
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={STATUS_OPTIONS}
            className="w-40"
          />
        </div>
      </Card>

      <Card className="mt-4">
        {users.isPending ? (
          <div className="flex justify-center py-12 text-[var(--surface-muted)]">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : users.isError ? (
          <p className="py-8 text-center text-sm text-red-400">{users.error.message}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--surface-border)] text-left text-xs text-[var(--surface-muted)]">
                    <th className="pb-2 font-medium">채널</th>
                    <th className="pb-2 font-medium">권한</th>
                    <th className="pb-2 font-medium">요금제</th>
                    <th className="pb-2 text-right font-medium">누적 결제</th>
                    <th className="pb-2 font-medium">가입일</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {users.data?.data.map((user) => (
                    <tr key={user.id} className="border-b border-[var(--surface-border)]/50">
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          {user.profileImageUrl ? (
                            <img
                              src={user.profileImageUrl}
                              alt=""
                              className="size-7 rounded-full"
                            />
                          ) : (
                            <div className="size-7 rounded-full bg-[var(--surface-raised)]" />
                          )}
                          <div className="min-w-0">
                            <p className="truncate font-medium">{user.channelName}</p>
                            <p className="truncate font-mono text-[11px] text-[var(--surface-muted)]">
                              {user.chzzkChannelId}
                            </p>
                          </div>
                          {user.status === 'SUSPENDED' ? (
                            <Badge className="border-red-500/40 text-red-400">정지</Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-2.5 text-[var(--surface-muted)]">
                        {PLATFORM_ROLE_LABELS[user.platformRole]}
                      </td>
                      <td className="py-2.5 text-[var(--surface-muted)]">
                        {user.planCode ?? '—'}
                        {user.subscriptionStatus ? (
                          <span className="ml-1 text-[11px]">
                            ({SUBSCRIPTION_STATUS_LABELS[user.subscriptionStatus]})
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2.5 text-right tabular-nums">
                        {user.lifetimeRevenue.toLocaleString('ko-KR')}원
                      </td>
                      <td className="py-2.5 text-[var(--surface-muted)]">
                        {new Date(user.createdAt).toLocaleDateString('ko-KR')}
                      </td>
                      <td className="py-2.5 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setTarget(user)}>
                          관리
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {users.data ? (
              <Pagination
                page={users.data.page}
                totalPages={users.data.totalPages}
                total={users.data.total}
                onChange={setPage}
              />
            ) : null}
          </>
        )}
      </Card>

      {target ? <UserActions user={target} onClose={() => setTarget(null)} /> : null}
    </div>
  );
}

/** 선택한 사용자에게 취할 수 있는 조치. 사유 입력을 강제합니다. */
function UserActions({ user, onClose }: { user: AdminUserRow; onClose: () => void }) {
  const suspend = useSuspendUser();
  const reinstate = useReinstateUser();
  const changeRole = useChangeRole();

  const [reason, setReason] = useState('');
  const [stopBots, setStopBots] = useState(true);
  const [role, setRole] = useState<PlatformRole>(user.platformRole);

  const roleOptions = platformRoleSchema.options.map(
    (value) => [value, PLATFORM_ROLE_LABELS[value]] as const
  );

  const suspended = user.status === 'SUSPENDED';
  const canSubmit = reason.trim().length > 0;

  return (
    <Card className="mt-4 border-amber-500/30">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{user.channelName} 관리</h2>
          <p className="mt-0.5 font-mono text-xs text-[var(--surface-muted)]">
            {user.chzzkChannelId}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          닫기
        </Button>
      </div>

      <Field
        label="사유 (필수)"
        hint="감사 로그에 그대로 남습니다. 나중에 이 조치를 설명할 사람이 읽습니다."
        className="mt-4"
      >
        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="예: 약관 위반 신고 접수 (티켓 #1234)"
          rows={2}
        />
      </Field>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">계정 상태</h3>

          {suspended ? (
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              disabled={!canSubmit}
              loading={reinstate.isPending}
              onClick={() => {
                reinstate.mutate({ userId: user.id, reason });
                onClose();
              }}
            >
              <ShieldCheck className="size-4" />
              정지 해제
            </Button>
          ) : (
            <>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <Switch checked={stopBots} onCheckedChange={setStopBots} />이 사람의 봇도 즉시 중지
              </label>
              <Button
                variant="danger"
                size="sm"
                className="mt-3"
                disabled={!canSubmit}
                loading={suspend.isPending}
                onClick={() => {
                  suspend.mutate({ userId: user.id, reason, stopBots });
                  onClose();
                }}
              >
                <ShieldOff className="size-4" />
                계정 정지
              </Button>
            </>
          )}
        </div>

        <div>
          <h3 className="text-sm font-semibold">플랫폼 권한</h3>
          <p className="mt-1 text-xs text-[var(--surface-muted)]">
            최고 관리자만 바꿀 수 있습니다.
          </p>
          <Select
            aria-label="플랫폼 권한"
            value={role}
            onValueChange={setRole}
            options={roleOptions}
            className="mt-3"
          />
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            disabled={!canSubmit || role === user.platformRole}
            loading={changeRole.isPending}
            onClick={() => {
              changeRole.mutate({ userId: user.id, platformRole: role, reason });
              onClose();
            }}
          >
            권한 변경
          </Button>
        </div>
      </div>
    </Card>
  );
}
