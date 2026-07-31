import { formResolver } from '../../../shared/form';

import { Controller, useForm } from 'react-hook-form';
import { ChevronDown, ShieldBan, Trash2 } from 'lucide-react';
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
import { MATCH_MODES, MODERATION_ACTIONS } from '../../../shared/constants';
import { bannedWord, type BannedWord } from '../../../shared/types';
import { useDeleteBannedWord, useUpdateBannedWord } from '../../../shared/api/bot';

export function BannedWordCard({
  word,
  tempBanAllowed,
}: {
  word: BannedWord;
  tempBanAllowed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const update = useUpdateBannedWord();
  const remove = useDeleteBannedWord();

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    formState: { errors, isDirty },
  } = useForm<BannedWord>({
    resolver: formResolver(bannedWord),
    defaultValues: word,
  });

  const enabled = watch('enabled');
  const action = watch('action');
  const mode = watch('mode');

  const onSubmit = handleSubmit((values) => {
    update.mutate({ ...values, id: word.id }, { onSuccess: () => reset(values) });
  });

  return (
    <Card dimmed={!enabled} className="overflow-hidden p-0">
      <div className="flex items-center gap-3 p-4">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-red-500/10 text-red-400">
          <ShieldBan className="size-4.5" />
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <code className="truncate font-semibold">{word.pattern}</code>
          <Badge>{MODERATION_ACTIONS.find(([v]) => v === action)?.[1]}</Badge>
          {word.hitCount > 0 ? <Badge tone="warn">{word.hitCount}회 적발</Badge> : null}
        </button>

        <Switch
          checked={enabled}
          onCheckedChange={(next) => update.mutate({ id: word.id, enabled: next })}
        />
        <Button variant="ghost" size="icon" onClick={() => setOpen((v) => !v)} aria-label="펼치기">
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </Button>
      </div>

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
                <Field label="단어 / 패턴" error={errors.pattern?.message}>
                  <Input {...register('pattern')} className={mode === 'regex' ? 'font-mono' : ''} />
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
                label="조치"
                error={errors.action?.message}
                hint={
                  action === 'blindAndTempBan' && !tempBanAllowed
                    ? '⚠ 임시제한이 꺼져 있어 지금은 숨기기까지만 실행됩니다. 위 설정에서 켜세요.'
                    : undefined
                }
              >
                <Controller
                  control={control}
                  name="action"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      options={MODERATION_ACTIONS}
                      aria-label="조치"
                    />
                  )}
                />
              </Field>

              <Field
                label="경고 문구"
                hint="비우면 기본 문구를 씁니다. {user} 를 쓸 수 있습니다."
                error={errors.warnMessage?.message}
              >
                <Input
                  {...register('warnMessage')}
                  placeholder="{user}님, 사용할 수 없는 표현입니다."
                />
              </Field>
            </div>

            <div className="flex items-center gap-2 border-t border-[var(--surface-border)] bg-[var(--surface-bg)]/40 px-5 py-3">
              <Button type="submit" variant="primary" size="sm" loading={update.isPending}>
                저장
              </Button>
              {isDirty ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => reset(word)}>
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
        title="금칙어를 삭제할까요?"
        description={word.pattern}
        onConfirm={() => remove.mutate(word.id)}
      />
    </Card>
  );
}
