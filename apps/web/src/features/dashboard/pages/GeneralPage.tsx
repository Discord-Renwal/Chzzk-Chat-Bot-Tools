import { formResolver } from '../../../shared/form';
import { useForm } from 'react-hook-form';

import { useEffect } from 'react';
import { Button, Card, CardTitle, Field, Input, Switch } from '@chzzk-bot/ui';
import { PageHeader } from '../components/Layout';
import { StatsPanel } from '../components/Stats';
import { generalSettings, type BotConfig, type BotStats } from '../../../shared/types';
import { useSaveSection } from '../../../shared/api/bot';

type General = BotConfig['general'];

export function GeneralPage({ config, stats }: { config: BotConfig; stats: BotStats | null }) {
  const save = useSaveSection('general');

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isDirty },
  } = useForm<General>({
    resolver: formResolver(generalSettings),
    defaultValues: config.general,
  });

  // 다른 탭에서 설정이 바뀌었을 때 폼도 따라가도록 맞춰줍니다.
  useEffect(() => {
    reset(config.general);
  }, [config.general, reset]);

  const onSubmit = handleSubmit((values) => save.mutate(values));

  return (
    <>
      <PageHeader title="일반" description="봇 전체 동작에 영향을 주는 설정입니다." />

      <div className="space-y-4">
        <StatsPanel stats={stats} />

        <Card>
          <form onSubmit={onSubmit} className="space-y-5">
            <CardTitle>기본 동작</CardTitle>

            <Switch
              checked={watch('enabled')}
              onCheckedChange={(v) => setValue('enabled', v, { shouldDirty: true })}
              label="봇 활성화"
              hint="끄면 채팅을 계속 받되 어떤 메시지도 보내지 않습니다."
            />

            <Switch
              checked={watch('replyOnUnknownCommand')}
              onCheckedChange={(v) => setValue('replyOnUnknownCommand', v, { shouldDirty: true })}
              label="없는 명령어에 안내하기"
              hint="관리자에게만 답합니다. 일반 시청자의 오타에는 반응하지 않습니다."
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="명령어 접두사" hint="기본값은 ! 입니다." error={errors.prefix?.message}>
                <Input {...register('prefix')} maxLength={5} className="font-mono" />
              </Field>

              <Field
                label="메시지 전송 간격 (ms)"
                hint="너무 짧으면 429(요청 초과)를 맞습니다. 1200 이상을 권합니다."
                error={errors.sendIntervalMs?.message}
              >
                <Input
                  type="number"
                  min={300}
                  max={10_000}
                  step={100}
                  {...register('sendIntervalMs', { valueAsNumber: true })}
                />
              </Field>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button type="submit" variant="primary" size="sm" loading={save.isPending}>
                저장
              </Button>
              {isDirty ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => reset(config.general)}
                >
                  되돌리기
                </Button>
              ) : null}
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
