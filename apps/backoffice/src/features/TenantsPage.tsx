import { Loader2, Power, Search, Sparkles } from 'lucide-react';
import { useState } from 'react';
import {
  BOT_STATUS_LABELS,
  type AdminTenantRow,
  type BotInstanceStatus,
} from '@chzzk-bot/contracts';
import { Badge, Button, Card, Field, Input, Select, Textarea } from '@chzzk-bot/ui';
import { PageHeader } from '../app/ConsoleLayout';
import { Pagination } from '../components/Pagination';
import { useControlBot, useOverrideSubscription, useTenants } from '../shared/api';

const STATUS_OPTIONS = [
  ['', '전체 상태'],
  ['ACTIVE', '활성'],
  ['PAUSED', '사용자 중지'],
  ['SUSPENDED', '운영자 정지'],
] as const;

const PLAN_OPTIONS = [
  ['FREE', '무료'],
  ['STARTER', '스타터'],
  ['PRO', '프로'],
  ['PARTNER', '파트너'],
] as const;

/**
 * 채널 관리 (요구사항 3번).
 *
 * 여기서 하는 일은 두 가지입니다 — 문제가 생긴 채널의 봇을 강제로 멈추거나 다시
 * 띄우는 것, 그리고 결제 없이 요금제를 열어 주는 것(파트너·보상). 둘 다 사유가
 * 필수입니다.
 */
export function TenantsPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<AdminTenantRow | null>(null);

  const tenants = useTenants({ q, status: status || undefined, page });

  return (
    <div>
      <PageHeader title="채널" description="봇 상태와 요금제를 확인하고 조치합니다." />

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
              placeholder="채널명 · slug · 채널 ID"
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
            className="w-44"
          />
        </div>
      </Card>

      <Card className="mt-4">
        {tenants.isPending ? (
          <div className="flex justify-center py-12 text-[var(--surface-muted)]">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : tenants.isError ? (
          <p className="py-8 text-center text-sm text-red-400">{tenants.error.message}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--surface-border)] text-left text-xs text-[var(--surface-muted)]">
                    <th className="pb-2 font-medium">채널</th>
                    <th className="pb-2 font-medium">주인</th>
                    <th className="pb-2 font-medium">요금제</th>
                    <th className="pb-2 font-medium">봇</th>
                    <th className="pb-2 text-right font-medium">명령어</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {tenants.data?.data.map((tenant) => (
                    <tr key={tenant.id} className="border-b border-[var(--surface-border)]/50">
                      <td className="py-2.5">
                        <p className="font-medium">{tenant.channelName}</p>
                        <p className="text-[11px] text-[var(--surface-muted)]">/{tenant.slug}</p>
                      </td>
                      <td className="py-2.5 text-[var(--surface-muted)]">{tenant.ownerName}</td>
                      <td className="py-2.5 text-[var(--surface-muted)]">
                        {tenant.planCode ?? '—'}
                      </td>
                      <td className="py-2.5">
                        <BotBadge status={tenant.botStatus} />
                      </td>
                      <td className="py-2.5 text-right tabular-nums">{tenant.commandCount}</td>
                      <td className="py-2.5 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setTarget(tenant)}>
                          관리
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {tenants.data ? (
              <Pagination
                page={tenants.data.page}
                totalPages={tenants.data.totalPages}
                total={tenants.data.total}
                onChange={setPage}
              />
            ) : null}
          </>
        )}
      </Card>

      {target ? <TenantActions tenant={target} onClose={() => setTarget(null)} /> : null}
    </div>
  );
}

function BotBadge({ status }: { status: string }) {
  const label = BOT_STATUS_LABELS[status as BotInstanceStatus] ?? status;
  if (status === 'JOINED')
    return <Badge className="border-brand-600/40 text-brand-300">{label}</Badge>;
  if (status === 'ERROR') return <Badge className="border-red-500/40 text-red-400">{label}</Badge>;
  return <Badge>{label}</Badge>;
}

function TenantActions({ tenant, onClose }: { tenant: AdminTenantRow; onClose: () => void }) {
  const controlBot = useControlBot();
  const override = useOverrideSubscription();

  const [reason, setReason] = useState('');
  const [planCode, setPlanCode] = useState('PRO');
  const [periodEnd, setPeriodEnd] = useState(defaultPeriodEnd());

  const canSubmit = reason.trim().length > 0;
  const running = tenant.botStatus === 'IDLE' || tenant.botStatus === 'JOINED';

  return (
    <Card className="mt-4 border-amber-500/30">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{tenant.channelName} 관리</h2>
          <p className="mt-0.5 text-xs text-[var(--surface-muted)]">
            주인 {tenant.ownerName} · /{tenant.slug}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          닫기
        </Button>
      </div>

      <Field label="사유 (필수)" hint="감사 로그에 남습니다." className="mt-4">
        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="예: 채팅 스팸 신고 접수, 봇 임시 중지"
          rows={2}
        />
      </Field>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">봇 제어</h3>
          <p className="mt-1 text-xs text-[var(--surface-muted)]">
            중지하면 채널이 정지 상태가 되어 사용자가 스스로 켤 수 없습니다.
          </p>
          <Button
            variant={running ? 'danger' : 'secondary'}
            size="sm"
            className="mt-3"
            disabled={!canSubmit}
            loading={controlBot.isPending}
            onClick={() => {
              controlBot.mutate({
                tenantId: tenant.id,
                action: running ? 'stop' : 'start',
                reason,
              });
              onClose();
            }}
          >
            <Power className="size-4" />
            {running ? '봇 강제 중지' : '봇 다시 시작'}
          </Button>
        </div>

        <div>
          <h3 className="text-sm font-semibold">요금제 수동 적용</h3>
          <p className="mt-1 text-xs text-[var(--surface-muted)]">
            결제 없이 열어 줍니다. 파트너 계약이나 장애 보상에 씁니다.
          </p>
          <div className="mt-3 flex gap-2">
            <Select
              aria-label="요금제"
              value={planCode}
              onValueChange={setPlanCode}
              options={PLAN_OPTIONS}
              className="w-32"
            />
            <Input
              type="date"
              value={periodEnd}
              onChange={(event) => setPeriodEnd(event.target.value)}
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            disabled={!canSubmit}
            loading={override.isPending}
            onClick={() => {
              override.mutate({
                tenantId: tenant.id,
                planCode,
                // date 입력은 날짜만 주므로 그날의 끝으로 맞춥니다.
                periodEnd: new Date(`${periodEnd}T23:59:59`).toISOString(),
                reason,
              });
              onClose();
            }}
          >
            <Sparkles className="size-4" />
            적용
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** 기본값은 한 달 뒤. 대부분의 수동 적용이 한 달 단위입니다. */
function defaultPeriodEnd(): string {
  const date = new Date();
  date.setMonth(date.getMonth() + 1);
  return date.toISOString().slice(0, 10);
}
