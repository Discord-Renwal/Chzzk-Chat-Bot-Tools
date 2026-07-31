import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { UserCheck } from 'lucide-react';
import { Badge, Button, Card, CardTitle, CheckChip, Field, Textarea } from '@chzzk-bot/ui';
import { PageHeader } from '../components/Layout';
import { formResolver } from '../../../shared/form';
import { ROLES } from '../../../shared/constants';
import { permissionSettings, type BotConfig, type UserRoleCodeValue } from '../../../shared/types';
import { useManagers, useSaveSection } from '../../../shared/api/bot';

type Permissions = BotConfig['permissions'];

const toLines = (values: string[]) => values.join('\n');
const fromLines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

export function PermissionsPage({ config }: { config: BotConfig }) {
  const save = useSaveSection('permissions');
  const managers = useManagers();

  const {
    handleSubmit,
    control,
    reset,
    formState: { isDirty },
  } = useForm<Permissions>({
    resolver: formResolver(permissionSettings),
    defaultValues: config.permissions,
  });

  // 서버 값이 갱신되면 폼도 맞춥니다. reset 은 RHF 내부 스토어를 바꾸는 것이라
  // React state 를 effect 안에서 직접 set 하는 것과는 다릅니다.
  useEffect(() => {
    reset(config.permissions);
  }, [config.permissions, reset]);

  const onSubmit = handleSubmit((values) => save.mutate(values));

  return (
    <>
      <PageHeader title="봇 권한 설정" description="누가 봇을 조작할 수 있는지 정합니다." />

      <Card>
        <form onSubmit={onSubmit} className="space-y-5">
          <CardTitle hint="여기 포함된 역할만 채팅에서 명령어 값을 바꿀 수 있습니다.">
            관리 권한
          </CardTitle>

          <Controller
            control={control}
            name="manageCommands"
            render={({ field }) => (
              <Field
                label="명령어를 채팅에서 관리할 수 있는 역할"
                hint={
                  <>
                    예를 들어{' '}
                    <code className="rounded bg-[var(--surface-raised)] px-1 py-0.5 text-brand-300">
                      {config.general.prefix}멤버 빅헤드,9구진
                    </code>{' '}
                    로 값을 바꾸는 권한입니다. 조회 권한은 명령어마다 따로 정합니다.
                  </>
                }
              >
                <div className="flex flex-wrap gap-1.5">
                  {ROLES.map(([value, label]) => (
                    <CheckChip
                      key={value}
                      label={label}
                      checked={field.value.includes(value)}
                      onChange={(event) =>
                        field.onChange(
                          event.target.checked
                            ? [...field.value, value]
                            : field.value.filter((r: UserRoleCodeValue) => r !== value)
                        )
                      }
                    />
                  ))}
                </div>
              </Field>
            )}
          />

          <Controller
            control={control}
            name="extraAdminChannelIds"
            render={({ field }) => (
              <Field
                label="추가 관리자 채널 ID"
                hint="한 줄에 하나씩. 치지직 매니저 권한을 주지 않고 봇 조작만 맡기고 싶을 때 사용합니다."
              >
                <Textarea
                  rows={3}
                  value={toLines(field.value)}
                  onChange={(event) => field.onChange(fromLines(event.target.value))}
                  placeholder="78bb78aeed19a0d610758e07a0b0bcf6"
                />

                {/*
                  치지직에 등록된 매니저를 가져와 한 번에 채웁니다.
                  손으로 채널 ID 를 옮겨 적는 건 실수하기 쉽습니다.
                */}
                {managers.data && managers.data.data.length > 0 ? (
                  <div className="mt-2 rounded-lg border border-[var(--surface-border)] p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-medium">
                      <UserCheck className="size-3.5 text-brand" />
                      치지직에 등록된 매니저 {managers.data.data.length}명
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {managers.data.data.map((manager) => {
                        const already = field.value.includes(manager.managerChannelId);
                        return (
                          <button
                            key={manager.managerChannelId}
                            type="button"
                            disabled={already}
                            onClick={() =>
                              field.onChange([...field.value, manager.managerChannelId])
                            }
                            className="disabled:opacity-50"
                          >
                            <Badge tone={already ? 'brand' : 'neutral'}>
                              {manager.managerChannelName}
                              {already ? ' ✓' : ' +'}
                            </Badge>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : managers.isError ? (
                  <p className="mt-2 text-xs text-[var(--surface-muted)]">
                    매니저 목록을 가져오지 못했습니다 — {managers.error.message}
                  </p>
                ) : null}
              </Field>
            )}
          />

          <Controller
            control={control}
            name="ignoredChannelIds"
            render={({ field }) => (
              <Field
                label="무시할 채널 ID"
                hint="여기 적힌 사람의 채팅에는 봇이 반응하지 않습니다. 다른 봇 계정을 넣어두면 봇끼리 서로 반응하는 일을 막습니다."
              >
                <Textarea
                  rows={3}
                  value={toLines(field.value)}
                  onChange={(event) => field.onChange(fromLines(event.target.value))}
                  placeholder="한 줄에 하나씩"
                />
              </Field>
            )}
          />

          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" size="sm" loading={save.isPending}>
              저장
            </Button>
            {isDirty ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => reset(config.permissions)}
              >
                되돌리기
              </Button>
            ) : null}
          </div>
        </form>
      </Card>
    </>
  );
}
