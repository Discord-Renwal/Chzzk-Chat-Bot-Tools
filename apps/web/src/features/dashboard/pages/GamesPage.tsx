import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Dices } from 'lucide-react';
import { Button, Card, CardTitle, Field, Input, Switch } from '@chzzk-bot/ui';
import { PageHeader } from '../components/Layout';
import { formResolver } from '../../../shared/form';
import { gameSettings, type BotConfig } from '../../../shared/types';
import { useSaveSection } from '../../../shared/api/bot';

type Games = BotConfig['games'];

export function GamesPage({ config }: { config: BotConfig }) {
  const save = useSaveSection('games');

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isDirty },
  } = useForm<Games>({
    resolver: formResolver(gameSettings),
    defaultValues: config.games,
  });

  useEffect(() => {
    reset(config.games);
  }, [config.games, reset]);

  const unit = config.points.unitName;
  const winPercent = watch('gambleWinPercent');
  const jackpot = watch('slotsJackpotMultiplier');
  const pair = watch('slotsPairMultiplier');

  // 슬롯 기대값 — 심볼 6종 기준. 설정을 바꿀 때 손해/이득을 바로 보여줍니다.
  const jackpotChance = 1 / 36; // 3개 일치
  const pairChance = 15 / 36; // 정확히 2개 일치
  const slotsExpected = jackpotChance * jackpot + pairChance * pair;

  return (
    <>
      <PageHeader
        title="미니게임"
        description={
          <>
            포인트를 거는 게임입니다. 포인트가 쌓이기만 하고 쓸 데가 없으면 아무도 신경 쓰지 않기
            때문에, <b className="text-[var(--surface-text)]">소모처</b>를 만드는 게 목적입니다.
          </>
        }
      />

      <Card>
        <form onSubmit={handleSubmit((values) => save.mutate(values))} className="space-y-5">
          <CardTitle>공통</CardTitle>

          <Switch
            checked={watch('enabled')}
            onCheckedChange={(v) => setValue('enabled', v, { shouldDirty: true })}
            label="미니게임 사용"
            hint={
              config.points.enabled
                ? undefined
                : '⚠ 포인트 기능이 꺼져 있어 게임이 동작하지 않습니다.'
            }
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={`최소 베팅 (${unit})`} error={errors.minBet?.message}>
              <Input type="number" min={1} {...register('minBet', { valueAsNumber: true })} />
            </Field>
            <Field
              label={`최대 베팅 (${unit})`}
              hint="'올인' 도 이 값이 상한입니다."
              error={errors.maxBet?.message}
            >
              <Input type="number" min={1} {...register('maxBet', { valueAsNumber: true })} />
            </Field>
            <Field label="쿨다운 (초)" error={errors.cooldownSec?.message}>
              <Input type="number" min={0} {...register('cooldownSec', { valueAsNumber: true })} />
            </Field>
          </div>

          <div className="rounded-xl border border-[var(--surface-border)] p-4">
            <Switch
              checked={watch('gambleEnabled')}
              onCheckedChange={(v) => setValue('gambleEnabled', v, { shouldDirty: true })}
              label="!도박"
              hint="이기면 베팅액만큼 벌고, 지면 잃습니다."
              className="mb-4"
            />
            <Field
              label="승률 (%)"
              error={errors.gambleWinPercent?.message}
              hint={
                winPercent >= 50
                  ? '⚠ 50% 이상이면 포인트가 계속 불어나 랭킹이 무의미해집니다.'
                  : `기대값 ${((winPercent / 100) * 2).toFixed(2)}배 — 1보다 낮아야 건전합니다.`
              }
              className="max-w-40"
            >
              <Input
                type="number"
                min={1}
                max={99}
                {...register('gambleWinPercent', { valueAsNumber: true })}
              />
            </Field>
          </div>

          <div className="rounded-xl border border-[var(--surface-border)] p-4">
            <Switch
              checked={watch('diceEnabled')}
              onCheckedChange={(v) => setValue('diceEnabled', v, { shouldDirty: true })}
              label="!주사위"
              hint="봇과 굴려 높은 쪽이 이깁니다. 무승부는 베팅액을 돌려줍니다."
            />
          </div>

          <div className="rounded-xl border border-[var(--surface-border)] p-4">
            <Switch
              checked={watch('slotsEnabled')}
              onCheckedChange={(v) => setValue('slotsEnabled', v, { shouldDirty: true })}
              label="!슬롯"
              hint="3개 일치는 잭팟, 2개 일치는 소액."
              className="mb-4"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="3개 일치 배율" error={errors.slotsJackpotMultiplier?.message}>
                <Input
                  type="number"
                  min={2}
                  {...register('slotsJackpotMultiplier', { valueAsNumber: true })}
                />
              </Field>
              <Field label="2개 일치 배율" error={errors.slotsPairMultiplier?.message}>
                <Input
                  type="number"
                  min={1}
                  {...register('slotsPairMultiplier', { valueAsNumber: true })}
                />
              </Field>
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--surface-muted)]">
              <Dices className="size-3.5" />
              현재 기대값{' '}
              <b className={slotsExpected > 1 ? 'text-amber-400' : 'text-brand'}>
                {slotsExpected.toFixed(2)}배
              </b>
              {slotsExpected > 1
                ? ' — 1을 넘으면 포인트가 계속 불어납니다.'
                : ' — 건전한 범위입니다.'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" size="sm" loading={save.isPending}>
              저장
            </Button>
            {isDirty ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => reset(config.games)}>
                되돌리기
              </Button>
            ) : null}
          </div>
        </form>
      </Card>
    </>
  );
}
