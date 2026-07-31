import { formResolver } from '../../../shared/form';

import { Controller, useForm } from 'react-hook-form';
import { ChevronDown, MessagesSquare, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Badge,
  Button,
  Card,
  cn,
  ConfirmDialog,
  Field,
  Input,
  Select,
  Switch,
} from '@chzzk-bot/ui';
import { MATCH_MODES } from '../../../shared/constants';
import { autoResponse, type AutoResponse } from '../../../shared/types';
import { useDeleteAutoResponse, useUpdateAutoResponse } from '../../../shared/api/bot';

export function AutoResponseCard({ rule }: { rule: AutoResponse }) {
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const update = useUpdateAutoResponse();
  const remove = useDeleteAutoResponse();

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    formState: { errors, isDirty },
  } = useForm<AutoResponse>({
    resolver: formResolver(autoResponse),
    defaultValues: rule,
  });

  const enabled = watch('enabled');
  const mode = watch('mode');

  const onSubmit = handleSubmit((values) => {
    update.mutate({ ...values, id: rule.id }, { onSuccess: () => reset(values) });
  });

  return (
    <Card dimmed={!enabled} className="overflow-hidden p-0">
      <div className="flex items-center gap-3 p-4">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-sky-500/10 text-sky-400">
          <MessagesSquare className="size-4.5" />
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="truncate font-semibold">{rule.label || rule.pattern}</span>
          <Badge>{MATCH_MODES.find(([v]) => v === mode)?.[1]}</Badge>
          {rule.chancePercent < 100 ? <Badge tone="warn">{rule.chancePercent}%</Badge> : null}
        </button>

        <Switch
          checked={enabled}
          onCheckedChange={(next) => update.mutate({ id: rule.id, enabled: next })}
        />
        <Button variant="ghost" size="icon" onClick={() => setOpen((v) => !v)} aria-label="펼치기">
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </Button>
      </div>

      {!open ? (
        <p className="truncate border-t border-[var(--surface-border)] px-4 py-2.5 text-[13px] text-[var(--surface-muted)]">
          <code className="text-brand-300">{rule.pattern}</code> → {rule.response}
        </p>
      ) : null}

      <AnimatePresence initial={false}>
        {open ? (
          <motion.form
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            onSubmit={onSubmit}
            className="overflow-hidden border-t border-[var(--surface-border)]"
          >
            <div className="space-y-4 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="이름"
                  hint="목록에서 알아보기 위한 이름입니다."
                  error={errors.label?.message}
                >
                  <Input {...register('label')} placeholder="인사 받아주기" />
                </Field>

                <Field label="조건" error={errors.mode?.message}>
                  <Controller
                    control={control}
                    name="mode"
                    render={({ field }) => (
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        options={MATCH_MODES}
                        aria-label="매칭 조건"
                      />
                    )}
                  />
                </Field>
              </div>

              <Field
                label="키워드"
                error={errors.pattern?.message}
                hint={
                  mode === 'regex'
                    ? '정규식입니다. 잘못 쓰면 저장이 거부됩니다.'
                    : '이 단어가 채팅에 나오면 반응합니다.'
                }
              >
                <Input {...register('pattern')} className={mode === 'regex' ? 'font-mono' : ''} />
              </Field>

              <Field
                label="응답 문구"
                error={errors.response?.message}
                hint={
                  <>
                    <code className="rounded bg-[var(--surface-raised)] px-1 py-0.5 text-brand-300">
                      {'{user}'}
                    </code>{' '}
                    자리에 호출한 사람 닉네임이 들어갑니다.
                  </>
                }
              >
                <Input {...register('response')} />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="쿨다운 (초)"
                  hint="채널 전체 공통입니다. 여러 명이 동시에 쳐도 도배하지 않습니다."
                  error={errors.cooldownSec?.message}
                >
                  <Input
                    type="number"
                    min={0}
                    max={3600}
                    {...register('cooldownSec', { valueAsNumber: true })}
                  />
                </Field>

                <Field
                  label="응답 확률 (%)"
                  hint="100 이면 항상 응답합니다. 낮추면 가끔만 반응합니다."
                  error={errors.chancePercent?.message}
                >
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    {...register('chancePercent', { valueAsNumber: true })}
                  />
                </Field>
              </div>
            </div>

            <div className="flex items-center gap-2 border-t border-[var(--surface-border)] bg-[var(--surface-bg)]/40 px-5 py-3">
              <Button type="submit" variant="primary" size="sm" loading={update.isPending}>
                저장
              </Button>
              {isDirty ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => reset(rule)}>
                  되돌리기
                </Button>
              ) : null}
              <span className="flex-1" />
              <Button type="button" variant="danger" size="sm" onClick={() => setConfirmOpen(true)}>
                <Trash2 className="size-3.5" />
                삭제
              </Button>
            </div>
          </motion.form>
        ) : null}
      </AnimatePresence>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="자동응답을 삭제할까요?"
        description={rule.label || rule.pattern}
        onConfirm={() => remove.mutate(rule.id)}
      />
    </Card>
  );
}
