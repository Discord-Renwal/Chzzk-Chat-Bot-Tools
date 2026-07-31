import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Button, Card, CardTitle, Field, Input, Switch } from '@chzzk-bot/ui';
import { PageHeader } from '../components/Layout';
import { formResolver } from '../../../shared/form';
import { notificationSettings, type BotConfig } from '../../../shared/types';
import { useSaveSection } from '../../../shared/api/bot';

type Notifications = BotConfig['notifications'];

export function NotificationsPage({ config }: { config: BotConfig }) {
  const save = useSaveSection('notifications');

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isDirty },
  } = useForm<Notifications>({
    resolver: formResolver(notificationSettings),
    defaultValues: config.notifications,
  });

  useEffect(() => {
    reset(config.notifications);
  }, [config.notifications, reset]);

  return (
    <>
      <PageHeader
        title="알림 · 인사"
        description={
          <>
            후원·구독에 자동으로 감사 인사를 보냅니다. 치지직 API 에는{' '}
            <b className="text-[var(--surface-text)]">팔로우 이벤트가 없어</b> 팔로우 알림은 만들 수
            없습니다.
          </>
        }
      />

      <Card>
        <form onSubmit={handleSubmit((values) => save.mutate(values))} className="space-y-5">
          <CardTitle hint="| 로 구분하면 그중 하나가 무작위로 나갑니다. 같은 말이 반복되지 않아 자연스럽습니다.">
            메시지
          </CardTitle>

          <div className="rounded-xl border border-[var(--surface-border)] p-4">
            <Switch
              checked={watch('donationEnabled')}
              onCheckedChange={(v) => setValue('donationEnabled', v, { shouldDirty: true })}
              label="후원 감사 인사"
              className="mb-4"
            />
            <Field
              label="문구"
              error={errors.donationMessage?.message}
              hint={
                <>
                  <code className="text-brand-300">{'{user}'}</code> 닉네임 ·{' '}
                  <code className="text-brand-300">{'{amount}'}</code> 금액 ·{' '}
                  <code className="text-brand-300">{'{message}'}</code> 후원 메시지 ·{' '}
                  <code className="text-brand-300">{'{points}'}</code> 적립 포인트
                </>
              }
            >
              <Input {...register('donationMessage')} />
            </Field>
            <Field
              label="최소 금액 (원)"
              hint="이 금액 미만은 알리지 않습니다. 소액 도배를 막습니다."
              error={errors.donationMinAmount?.message}
              className="mt-4 max-w-40"
            >
              <Input
                type="number"
                min={0}
                {...register('donationMinAmount', { valueAsNumber: true })}
              />
            </Field>
          </div>

          <div className="rounded-xl border border-[var(--surface-border)] p-4">
            <Switch
              checked={watch('subscriptionEnabled')}
              onCheckedChange={(v) => setValue('subscriptionEnabled', v, { shouldDirty: true })}
              label="구독 감사 인사"
              className="mb-4"
            />
            <Field
              label="문구"
              error={errors.subscriptionMessage?.message}
              hint={
                <>
                  <code className="text-brand-300">{'{user}'}</code> 닉네임 ·{' '}
                  <code className="text-brand-300">{'{month}'}</code> 개월 ·{' '}
                  <code className="text-brand-300">{'{tier}'}</code> 티어
                </>
              }
            >
              <Input {...register('subscriptionMessage')} />
            </Field>
          </div>

          <div className="rounded-xl border border-[var(--surface-border)] p-4">
            <Switch
              checked={watch('greeting.enabled')}
              onCheckedChange={(v) => setValue('greeting.enabled', v, { shouldDirty: true })}
              label="첫 채팅 인사"
              hint="이 채널에서 처음 채팅한 사람에게 한 번만 보냅니다."
              className="mb-4"
            />
            <Field
              label="문구"
              error={errors.greeting?.firstTimeMessage?.message}
              hint={
                <>
                  <code className="text-brand-300">$닉네임</code> 을 쓸 수 있습니다.
                </>
              }
            >
              <Input {...register('greeting.firstTimeMessage')} />
            </Field>
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
                onClick={() => reset(config.notifications)}
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
