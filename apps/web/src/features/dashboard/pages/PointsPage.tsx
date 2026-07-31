import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Coins, Crown, Minus, Plus, RotateCcw, Search } from 'lucide-react';
import {
  Button,
  Card,
  CardTitle,
  cn,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Switch,
} from '@chzzk-bot/ui';
import { PageHeader } from '../components/Layout';
import { formResolver } from '../../../shared/form';
import { pointSettings, type BotConfig } from '../../../shared/types';
import { useGrantPoints, useResetPoints, useSaveSection, useUsers } from '../../../shared/api/bot';

type Points = BotConfig['points'];

export function PointsPage({ config }: { config: BotConfig }) {
  const save = useSaveSection('points');
  const users = useUsers();
  const grant = useGrantPoints();
  const reset = useResetPoints();

  const [query, setQuery] = useState('');
  const [resetOpen, setResetOpen] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset: resetForm,
    formState: { errors, isDirty },
  } = useForm<Points>({
    resolver: formResolver(pointSettings),
    defaultValues: config.points,
  });

  useEffect(() => {
    resetForm(config.points);
  }, [config.points, resetForm]);

  const unit = config.points.unitName;
  const list = (users.data?.users ?? []).filter((u) =>
    u.nickname.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <>
      <PageHeader
        title="포인트 설정"
        description={
          <>
            치지직 API 에는 시청자 목록 조회가 없어{' '}
            <b className="text-[var(--surface-text)]">시청 시간 기반 적립은 만들 수 없습니다</b>.
            채팅·후원·구독으로만 적립되며, 채팅 도배로 긁어모으지 못하도록 사람별 쿨다운을 둡니다.
          </>
        }
      />

      <Card className="mb-4">
        <form onSubmit={handleSubmit((values) => save.mutate(values))} className="space-y-5">
          <CardTitle>적립 규칙</CardTitle>

          <Switch
            checked={watch('enabled')}
            onCheckedChange={(v) => setValue('enabled', v, { shouldDirty: true })}
            label="포인트 기능 사용"
            hint="끄면 적립도 게임도 동작하지 않습니다."
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="포인트 이름"
              hint="채팅에 표시되는 단위입니다. 예: 젤리, 코인"
              error={errors.unitName?.message}
            >
              <Input {...register('unitName')} maxLength={10} />
            </Field>
            <Field label="채팅 1회당 적립" error={errors.perChat?.message}>
              <Input type="number" min={0} {...register('perChat', { valueAsNumber: true })} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="적립 쿨다운 (초)"
              hint="도배 방지"
              error={errors.chatCooldownSec?.message}
            >
              <Input
                type="number"
                min={0}
                {...register('chatCooldownSec', { valueAsNumber: true })}
              />
            </Field>
            <Field label="후원 1000원당" error={errors.perThousandWon?.message}>
              <Input
                type="number"
                min={0}
                {...register('perThousandWon', { valueAsNumber: true })}
              />
            </Field>
            <Field label="구독 1개월당" error={errors.perSubscriptionMonth?.message}>
              <Input
                type="number"
                min={0}
                {...register('perSubscriptionMonth', { valueAsNumber: true })}
              />
            </Field>
          </div>

          <div className="rounded-xl border border-[var(--surface-border)] p-4">
            <Switch
              checked={watch('attendance.enabled')}
              onCheckedChange={(v) => setValue('attendance.enabled', v, { shouldDirty: true })}
              label="출석 체크"
              hint="!출석 으로 하루 한 번 보상을 받습니다. 연속 출석 보너스가 리텐션에 효과적입니다."
              className="mb-4"
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="기본 보상">
                <Input
                  type="number"
                  min={0}
                  {...register('attendance.reward', { valueAsNumber: true })}
                />
              </Field>
              <Field label="연속 1일당 추가">
                <Input
                  type="number"
                  min={0}
                  {...register('attendance.streakBonus', { valueAsNumber: true })}
                />
              </Field>
              <Field label="연속 보너스 상한">
                <Input
                  type="number"
                  min={0}
                  {...register('attendance.maxStreakBonus', { valueAsNumber: true })}
                />
              </Field>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" size="sm" loading={save.isPending}>
              저장
            </Button>
            {isDirty ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => resetForm(config.points)}
              >
                되돌리기
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      {/* 보유 현황 */}
      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <h3 className="text-[15px] font-semibold">시청자 {unit} 현황</h3>
            <p className="mt-0.5 text-xs text-[var(--surface-muted)]">
              총 {users.data?.total ?? 0}명 · 상위 200명까지 표시
            </p>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--surface-muted)]" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="닉네임 검색"
              className="w-44 pl-8"
            />
          </div>
          <Button variant="danger" size="sm" onClick={() => setResetOpen(true)}>
            <RotateCcw className="size-3.5" />
            전체 초기화
          </Button>
        </div>

        {list.length === 0 ? (
          <EmptyState icon={<Coins className="size-5" />} title="아직 기록이 없습니다">
            봇이 실행 중이고 채팅이 오가면 여기에 쌓입니다.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b border-[var(--surface-border)] text-left text-xs text-[var(--surface-muted)]">
                  <th className="pb-2 pl-1 font-medium">#</th>
                  <th className="pb-2 font-medium">닉네임</th>
                  <th className="pb-2 text-right font-medium">{unit}</th>
                  <th className="pb-2 text-right font-medium">채팅</th>
                  <th className="pb-2 text-right font-medium">연속출석</th>
                  <th className="pb-2 pr-1 text-right font-medium">조정</th>
                </tr>
              </thead>
              <tbody>
                {list.slice(0, 50).map((user, index) => (
                  <tr
                    key={user.channelId}
                    className="border-b border-[var(--surface-border)]/60 last:border-0"
                  >
                    <td className="py-2 pl-1 tabular-nums text-[var(--surface-muted)]">
                      {index < 3 ? (
                        <Crown
                          className={cn(
                            'size-4',
                            index === 0 && 'text-amber-400',
                            index === 1 && 'text-slate-300',
                            index === 2 && 'text-amber-700'
                          )}
                        />
                      ) : (
                        index + 1
                      )}
                    </td>
                    <td className="max-w-40 truncate py-2 font-medium">
                      {user.nickname || '익명'}
                    </td>
                    <td className="py-2 text-right tabular-nums text-brand">
                      {user.points.toLocaleString('ko-KR')}
                    </td>
                    <td className="py-2 text-right tabular-nums text-[var(--surface-muted)]">
                      {user.chatCount.toLocaleString('ko-KR')}
                    </td>
                    <td className="py-2 text-right tabular-nums text-[var(--surface-muted)]">
                      {user.attendanceStreak}일
                    </td>
                    <td className="py-2 pr-1">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="100 회수"
                          onClick={() => grant.mutate({ channelId: user.channelId, delta: -100 })}
                        >
                          <Minus className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="100 지급"
                          onClick={() => grant.mutate({ channelId: user.channelId, delta: 100 })}
                        >
                          <Plus className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={`모든 시청자의 ${unit}를 0으로 만들까요?`}
        description="시즌을 새로 시작할 때 쓰세요. 채팅 수와 출석 기록은 유지됩니다. 되돌릴 수 없습니다."
        confirmLabel="초기화"
        onConfirm={() => reset.mutate(undefined)}
      />
    </>
  );
}
