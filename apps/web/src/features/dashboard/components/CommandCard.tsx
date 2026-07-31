import { formResolver } from '../../../shared/form';

import { Controller, useForm, type Control } from 'react-hook-form';
import { ChevronDown, Hash, List, MessageSquareText, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Badge,
  Button,
  Card,
  CheckChip,
  cn,
  ConfirmDialog,
  Field,
  Input,
  Select,
  Switch,
} from '@chzzk-bot/ui';
import { ListEditor } from './ListEditor';
import { COMMAND_TYPES, COMMAND_TYPE_HINTS, ROLES } from '../../../shared/constants';
import { useCommonVariables } from '../../../shared/api/systemVariables';
import { customCommand, type CustomCommand, type UserRoleCodeValue } from '../../../shared/types';
import { useDeleteCommand, useUpdateCommand } from '../../../shared/api/bot';

const TYPE_ICONS = {
  text: MessageSquareText,
  list: List,
  counter: Hash,
} as const;

interface CommandCardProps {
  command: CustomCommand;
  prefix: string;
}

export function CommandCard({ command, prefix }: CommandCardProps) {
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const update = useUpdateCommand();
  const remove = useDeleteCommand();
  const commonVariables = useCommonVariables();

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    reset,
    formState: { errors, isDirty },
  } = useForm<CustomCommand>({
    // 서버와 같은 스키마로 검증합니다. 규칙이 어긋날 수 없습니다.
    resolver: formResolver(customCommand),
    defaultValues: command,
  });

  const type = watch('type');
  const enabled = watch('enabled');
  const Icon = TYPE_ICONS[type];

  const onSubmit = handleSubmit((values) => {
    update.mutate({ ...values, id: command.id }, { onSuccess: () => reset(values) });
  });

  /** 스위치는 펼치지 않고도 즉시 반영되는 게 자연스럽습니다. */
  function toggleEnabled(next: boolean) {
    update.mutate({ id: command.id, enabled: next });
  }

  return (
    <Card dimmed={!enabled} className="overflow-hidden p-0">
      {/* 헤더 — 접힌 상태에서도 핵심 정보가 보이도록 */}
      <div className="flex items-center gap-3 p-4">
        <div
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-lg',
            'bg-brand/10 text-brand'
          )}
        >
          <Icon className="size-4.5" />
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="truncate font-semibold">
            <span className="text-[var(--surface-muted)]">{prefix}</span>
            {command.name}
          </span>
          <Badge tone="brand">{COMMAND_TYPES.find(([v]) => v === type)?.[1]}</Badge>
          {command.type === 'list' && command.items.length > 0 ? (
            <Badge>{command.items.length}개 등록</Badge>
          ) : null}
          <Badge>사용 {command.usedCount}회</Badge>
        </button>

        <Switch checked={enabled} onCheckedChange={toggleEnabled} />

        <Button
          variant="ghost"
          size="icon"
          aria-label={open ? '접기' : '펼치기'}
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </Button>
      </div>

      {/* 접힌 상태에서 목록형이면 현재 값을 미리 보여줍니다. */}
      {!open && command.type === 'list' && command.items.length > 0 ? (
        <p className="truncate border-t border-[var(--surface-border)] px-4 py-2.5 text-[13px] text-[var(--surface-muted)]">
          {command.items.join(', ')}
        </p>
      ) : null}

      <AnimatePresence initial={false}>
        {open ? (
          <motion.form
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            onSubmit={onSubmit}
            className="overflow-hidden border-t border-[var(--surface-border)]"
          >
            <div className="space-y-4 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="명령어 이름" error={errors.name?.message}>
                  <Input {...register('name')} placeholder="멤버" />
                </Field>

                <Field label="종류" hint={COMMAND_TYPE_HINTS[type]} error={errors.type?.message}>
                  <Controller
                    control={control}
                    name="type"
                    render={({ field }) => (
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        options={COMMAND_TYPES}
                        aria-label="명령어 종류"
                      />
                    )}
                  />
                </Field>
              </div>

              <Controller
                control={control}
                name="aliases"
                render={({ field }) => (
                  <Field
                    label="별칭"
                    hint="같은 명령을 부르는 다른 이름입니다. 다른 명령과 겹치면 저장이 거부됩니다."
                    error={errors.aliases?.message}
                  >
                    <ListEditor
                      items={field.value}
                      onChange={field.onChange}
                      placeholder="member, 팀"
                    />
                  </Field>
                )}
              />

              {type === 'list' ? (
                <Controller
                  control={control}
                  name="items"
                  render={({ field }) => (
                    <Field
                      label="등록된 목록"
                      hint={
                        <>
                          채팅에서는{' '}
                          <code className="rounded bg-[var(--surface-raised)] px-1 py-0.5">
                            {prefix}
                            {command.name} 빅헤드,9구진
                          </code>{' '}
                          으로도 바꿀 수 있습니다.
                        </>
                      }
                    >
                      <ListEditor items={field.value} onChange={field.onChange} />
                    </Field>
                  )}
                />
              ) : null}

              {type === 'counter' ? (
                <Field label="현재 값" error={errors.count?.message}>
                  <Input type="number" min={0} {...register('count', { valueAsNumber: true })} />
                </Field>
              ) : null}

              <Field
                label="응답 문구"
                error={errors.response?.message}
                hint={
                  <span className="flex flex-wrap gap-x-3 gap-y-1">
                    {commonVariables.map((variable) => (
                      <span key={variable.name}>
                        <code className="rounded bg-[var(--surface-raised)] px-1 py-0.5 text-brand-300">
                          {`${variable.name}`}
                        </code>{' '}
                        {variable.description}
                      </span>
                    ))}
                  </span>
                }
              >
                <Input {...register('response')} placeholder="비우면 기본 형식으로 출력합니다" />
              </Field>

              {/* 역할 칩 4개가 한 줄에 들어가도록 전체 너비를 씁니다. */}
              <RoleField
                control={control}
                name="useRoles"
                label="사용할 수 있는 역할"
                hint="이 명령을 호출(조회)할 수 있는 사람입니다."
              />
              <RoleField
                control={control}
                name="editRoles"
                label="값을 수정할 수 있는 역할"
                hint="목록형·카운터에서만 의미가 있습니다."
              />

              <Switch
                checked={watch('subscriberOnly')}
                onCheckedChange={(v) => setValue('subscriberOnly', v, { shouldDirty: true })}
                label="구독자 전용"
                hint="구독자 목록을 주기적으로 받아 대조합니다. 스트리머 계정이 아니면 목록 조회가 막혀 동작하지 않습니다. 관리자는 항상 사용할 수 있습니다."
              />

              <Field
                label="쿨다운 (초)"
                hint="같은 사람이 다시 호출하기까지 기다리는 시간입니다."
                error={errors.cooldownSec?.message}
                className="max-w-40"
              >
                <Input
                  type="number"
                  min={0}
                  max={3600}
                  {...register('cooldownSec', { valueAsNumber: true })}
                />
              </Field>
            </div>

            <div className="flex items-center gap-2 border-t border-[var(--surface-border)] bg-[var(--surface-bg)]/40 px-5 py-3">
              <Button type="submit" variant="primary" size="sm" loading={update.isPending}>
                저장
              </Button>
              {isDirty ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => reset(command)}>
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
        title={`${prefix}${command.name} 명령을 삭제할까요?`}
        description="등록해 둔 목록과 설정이 함께 사라집니다. 되돌릴 수 없습니다."
        onConfirm={() => remove.mutate(command.id)}
      />
    </Card>
  );
}

/** 역할 다중 선택 — useRoles / editRoles 가 같은 모양이라 묶었습니다. */
function RoleField({
  control,
  name,
  label,
  hint,
}: {
  control: Control<CustomCommand>;
  name: 'useRoles' | 'editRoles';
  label: string;
  hint: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Field label={label} hint={hint}>
          <div className="flex flex-wrap gap-1.5">
            {ROLES.map(([value, roleLabel]) => (
              <CheckChip
                key={value}
                label={roleLabel}
                checked={field.value.includes(value)}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...field.value, value]
                    : field.value.filter((r: UserRoleCodeValue) => r !== value);
                  field.onChange(next);
                }}
              />
            ))}
          </div>
        </Field>
      )}
    />
  );
}
