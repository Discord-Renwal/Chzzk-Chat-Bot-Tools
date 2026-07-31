import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { ChevronDown, ChevronUp, Music, Play, SkipForward, Trash2, X } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  CheckChip,
  EmptyState,
  Field,
  Input,
  Switch,
} from '@chzzk-bot/ui';
import { PageHeader } from '../components/Layout';
import { formResolver } from '../../../shared/form';
import { ROLES } from '../../../shared/constants';
import { songSettings, type BotConfig, type UserRoleCodeValue } from '../../../shared/types';
import {
  useClearSongs,
  useMoveSong,
  useNextSong,
  useRemoveSong,
  useSaveSection,
  useSongs,
} from '../../../shared/api/bot';

type Songs = BotConfig['songs'];

export function SongsPage({ config }: { config: BotConfig }) {
  const save = useSaveSection('songs');
  const songs = useSongs();
  const next = useNextSong();
  const clear = useClearSongs();
  const move = useMoveSong();
  const remove = useRemoveSong();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isDirty },
  } = useForm<Songs>({
    resolver: formResolver(songSettings),
    defaultValues: config.songs,
  });

  useEffect(() => {
    reset(config.songs);
  }, [config.songs, reset]);

  const allowedRoles = watch('allowedRoles');
  const playing = songs.data?.playing ?? null;
  const pending = songs.data?.pending ?? [];

  return (
    <>
      <PageHeader
        title="신청곡 설정"
        description="제목만 받아 순서를 관리합니다. 재생은 직접 하시면 됩니다 — 외부 음악 서비스 연동은 하지 않습니다."
      />

      {/* 대기열 제어 */}
      <Card className="mb-4">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex-1">
            <h3 className="text-[15px] font-semibold">대기열</h3>
            <p className="mt-0.5 text-xs text-[var(--surface-muted)]">
              대기 {pending.length}곡{playing ? ' · 재생 중 1곡' : ''}
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => next.mutate(undefined)}
            loading={next.isPending}
          >
            <Play className="size-3.5" />
            다음 곡
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => clear.mutate(undefined)}
            disabled={pending.length === 0}
          >
            대기열 비우기
          </Button>
        </div>

        {playing ? (
          <div className="mb-3 flex items-center gap-3 rounded-xl border border-brand-600/40 bg-brand/10 px-4 py-3">
            <Play className="size-4 shrink-0 text-brand" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{playing.title}</p>
              <p className="text-xs text-[var(--surface-muted)]">
                {playing.requesterNickname}님 신청
              </p>
            </div>
            <Badge tone="brand">재생 중</Badge>
          </div>
        ) : null}

        {pending.length === 0 ? (
          <EmptyState icon={<Music className="size-5" />} title="대기 중인 신청곡이 없습니다">
            시청자가 <code className="text-brand">{config.general.prefix}신청곡 제목</code> 으로
            추가할 수 있습니다.
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {pending.map((song, index) => (
              <li
                key={song.id}
                className="flex items-center gap-3 rounded-lg border border-[var(--surface-border)] px-3 py-2"
              >
                <span className="w-5 shrink-0 text-center text-sm tabular-nums text-[var(--surface-muted)]">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{song.title}</p>
                  <p className="text-xs text-[var(--surface-muted)]">
                    {song.requesterNickname}
                    {song.pointsSpent > 0
                      ? ` · ${song.pointsSpent.toLocaleString('ko-KR')}${config.points.unitName}`
                      : ''}
                  </p>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="위로"
                    disabled={index === 0}
                    onClick={() => move.mutate({ id: song.id, direction: 'up' })}
                  >
                    <ChevronUp className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="아래로"
                    disabled={index === pending.length - 1}
                    onClick={() => move.mutate({ id: song.id, direction: 'down' })}
                  >
                    <ChevronDown className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="삭제"
                    onClick={() => remove.mutate(song.id)}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 규칙 */}
      <Card className="mb-4">
        <form onSubmit={handleSubmit((values) => save.mutate(values))} className="space-y-5">
          <CardTitle>신청 규칙</CardTitle>

          <Switch
            checked={watch('enabled')}
            onCheckedChange={(v) => setValue('enabled', v, { shouldDirty: true })}
            label="신청곡 받기"
            hint="끄면 !신청곡 명령이 동작하지 않습니다. 방송 중 신청만 잠글 때 쓰세요 — 대기열은 그대로 남습니다."
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="1인당 최대" error={errors.maxPerUser?.message}>
              <Input type="number" min={1} {...register('maxPerUser', { valueAsNumber: true })} />
            </Field>
            <Field label="대기열 상한" error={errors.maxQueueSize?.message}>
              <Input type="number" min={1} {...register('maxQueueSize', { valueAsNumber: true })} />
            </Field>
            <Field
              label={`신청 비용 (${config.points.unitName})`}
              hint="0 이면 무료"
              error={errors.cost?.message}
            >
              <Input type="number" min={0} {...register('cost', { valueAsNumber: true })} />
            </Field>
          </div>

          <Switch
            checked={watch('allowDuplicate')}
            onCheckedChange={(v) => setValue('allowDuplicate', v, { shouldDirty: true })}
            label="같은 곡 중복 신청 허용"
          />

          <Field label="신청할 수 있는 역할">
            <div className="flex flex-wrap gap-1.5">
              {ROLES.map(([value, label]) => (
                <CheckChip
                  key={value}
                  label={label}
                  checked={allowedRoles.includes(value)}
                  onChange={(e) =>
                    setValue(
                      'allowedRoles',
                      e.target.checked
                        ? [...allowedRoles, value]
                        : allowedRoles.filter((r: UserRoleCodeValue) => r !== value),
                      { shouldDirty: true }
                    )
                  }
                />
              ))}
            </div>
          </Field>

          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" size="sm" loading={save.isPending}>
              저장
            </Button>
            {isDirty ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => reset(config.songs)}>
                되돌리기
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      {/* 기록 */}
      {songs.data && songs.data.history.length > 0 ? (
        <Card>
          <CardTitle>최근 재생 기록</CardTitle>
          <ul className="space-y-1.5">
            {songs.data.history.map((song) => (
              <li key={song.id} className="flex items-center gap-2 text-sm">
                {song.status === 'skipped' ? (
                  <SkipForward className="size-3.5 shrink-0 text-amber-400" />
                ) : (
                  <Trash2 className="size-3.5 shrink-0 text-[var(--surface-muted)]" />
                )}
                <span className="min-w-0 flex-1 truncate">{song.title}</span>
                <span className="shrink-0 text-xs text-[var(--surface-muted)]">
                  {song.requesterNickname}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
