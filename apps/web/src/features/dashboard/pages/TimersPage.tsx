import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { AlarmClock, Plus, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Switch,
} from '@chzzk-bot/ui';
import { PageHeader } from '../components/Layout';
import { formResolver } from '../../../shared/form';
import { timerMessage, type BotConfig, type TimerMessage } from '../../../shared/types';
import { useCreateTimer, useDeleteTimer, useUpdateTimer } from '../../../shared/api/bot';

export function TimersPage({ config }: { config: BotConfig }) {
  const create = useCreateTimer();

  return (
    <>
      <PageHeader
        title="주기 메시지"
        description="정해진 간격마다 자동으로 채팅을 보냅니다. 시간뿐 아니라 최소 채팅 수 조건을 함께 걸어, 아무도 없는 방송에 봇 혼자 떠드는 일을 막습니다."
      />

      <Button
        variant="primary"
        className="mb-4"
        loading={create.isPending}
        onClick={() =>
          create.mutate({
            label: '새 주기 메시지',
            message: '$방제 — 즐겁게 시청해 주세요!',
            intervalMinutes: 15,
            minChatsSinceLast: 10,
          })
        }
      >
        <Plus className="size-4" />
        주기 메시지 추가
      </Button>

      {config.timers.length === 0 ? (
        <EmptyState icon={<AlarmClock className="size-5" />} title="등록된 주기 메시지가 없습니다">
          디스코드 주소 안내, 방송 규칙 공지처럼 반복해서 알릴 내용에 씁니다.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {config.timers.map((timer) => (
            <TimerCard key={timer.id} timer={timer} />
          ))}
        </div>
      )}
    </>
  );
}

function TimerCard({ timer }: { timer: TimerMessage }) {
  const update = useUpdateTimer();
  const remove = useDeleteTimer();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isDirty },
  } = useForm<TimerMessage>({
    resolver: formResolver(timerMessage),
    defaultValues: timer,
  });

  const enabled = watch('enabled');

  return (
    <Card dimmed={!enabled}>
      <form
        onSubmit={handleSubmit((values) =>
          update.mutate({ ...values, id: timer.id }, { onSuccess: () => reset(values) })
        )}
        className="space-y-4"
      >
        <div className="flex items-center gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-violet-500/10 text-violet-400">
            <AlarmClock className="size-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{timer.label || '이름 없음'}</p>
            <p className="text-xs text-[var(--surface-muted)]">
              {timer.intervalMinutes}분마다 · 채팅 {timer.minChatsSinceLast}줄 이상
            </p>
          </div>
          <Badge>{timer.intervalMinutes}분</Badge>
          <Switch
            checked={enabled}
            onCheckedChange={(next) => update.mutate({ id: timer.id, enabled: next })}
          />
        </div>

        <Field label="이름" error={errors.label?.message}>
          <Input {...register('label')} placeholder="디스코드 안내" />
        </Field>

        <Field
          label="메시지"
          error={errors.message?.message}
          hint="$방제 · $게임 변수를 쓸 수 있습니다. | 로 구분하면 그중 하나가 무작위로 나갑니다."
        >
          <Input {...register('message')} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="간격 (분)" error={errors.intervalMinutes?.message}>
            <Input
              type="number"
              min={1}
              max={1440}
              {...register('intervalMinutes', { valueAsNumber: true })}
            />
          </Field>
          <Field
            label="최소 채팅 수"
            hint="지난 발사 이후 이만큼 채팅이 오가야 보냅니다. 0 이면 시간만 봅니다."
            error={errors.minChatsSinceLast?.message}
          >
            <Input
              type="number"
              min={0}
              max={500}
              {...register('minChatsSinceLast', { valueAsNumber: true })}
            />
          </Field>
        </div>

        <div className="flex items-center gap-2">
          <Button type="submit" variant="primary" size="sm" loading={update.isPending}>
            저장
          </Button>
          {isDirty ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => reset(timer)}>
              되돌리기
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button type="button" variant="danger" size="sm" onClick={() => setConfirmOpen(true)}>
            <Trash2 className="size-3.5" />
            삭제
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="주기 메시지를 삭제할까요?"
        description={timer.label || timer.message}
        onConfirm={() => remove.mutate(timer.id)}
      />
    </Card>
  );
}
