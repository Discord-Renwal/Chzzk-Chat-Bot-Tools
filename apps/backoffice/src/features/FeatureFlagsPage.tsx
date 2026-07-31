import { Loader2, Save } from 'lucide-react';
import { useState } from 'react';
import type { FeatureFlag } from '@chzzk-bot/contracts';
import { Button, Card, Field, Input, Switch } from '@chzzk-bot/ui';
import { PageHeader } from '../app/ConsoleLayout';
import { useFeatureFlags, useUpsertFeatureFlag } from '../shared/api';

/**
 * 기능 플래그 (요구사항 3번).
 *
 * 새 기능을 전체에 한 번에 켜지 않기 위한 장치입니다. 먼저 우리 채널에만
 * (`allowTenantIds`), 그다음 10%, 그다음 전체 순으로 엽니다. 문제가 생기면
 * 배포를 되돌리는 대신 여기서 끄면 됩니다 — 훨씬 빠르고 안전합니다.
 */
export function FeatureFlagsPage() {
  const flags = useFeatureFlags();
  const upsert = useUpsertFeatureFlag();

  return (
    <div>
      <PageHeader
        title="기능 플래그"
        description="새 기능을 일부에게만 먼저 열어 봅니다. 끄면 즉시 반영됩니다."
      />

      <NewFlagForm />

      <div className="mt-4 space-y-3">
        {flags.isPending ? (
          <div className="flex justify-center py-12 text-[var(--surface-muted)]">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (flags.data?.flags.length ?? 0) === 0 ? (
          <Card>
            <p className="py-6 text-center text-sm text-[var(--surface-muted)]">
              등록된 플래그가 없습니다.
            </p>
          </Card>
        ) : (
          flags.data?.flags.map((flag) => (
            <FlagRow key={flag.id} flag={flag} onSave={(values) => upsert.mutate(values)} />
          ))
        )}
      </div>
    </div>
  );
}

function NewFlagForm() {
  const upsert = useUpsertFeatureFlag();
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');

  const valid = /^[a-z][a-z0-9-]*$/.test(key);

  return (
    <Card>
      <h2 className="font-semibold">새 플래그</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-[16rem_1fr_auto]">
        <Field
          label="키"
          error={key.length > 0 && !valid ? '소문자·숫자·하이픈만 쓸 수 있습니다.' : undefined}
        >
          <Input
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="new-song-queue"
          />
        </Field>
        <Field label="설명">
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="무엇을 켜고 끄는지"
          />
        </Field>
        <div className="flex items-end">
          <Button
            size="sm"
            disabled={!valid}
            loading={upsert.isPending}
            onClick={() => {
              upsert.mutate({
                key,
                description,
                enabled: false,
                rolloutPercent: 0,
                allowTenantIds: [],
              });
              setKey('');
              setDescription('');
            }}
          >
            추가
          </Button>
        </div>
      </div>
    </Card>
  );
}

function FlagRow({
  flag,
  onSave,
}: {
  flag: FeatureFlag;
  onSave: (values: {
    key: string;
    description: string;
    enabled: boolean;
    rolloutPercent: number;
    allowTenantIds: string[];
  }) => void;
}) {
  const [enabled, setEnabled] = useState(flag.enabled);
  const [rollout, setRollout] = useState(flag.rolloutPercent);
  const [allowList, setAllowList] = useState(flag.allowTenantIds.join(', '));

  const dirty =
    enabled !== flag.enabled ||
    rollout !== flag.rolloutPercent ||
    allowList !== flag.allowTenantIds.join(', ');

  return (
    <Card>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <code className="text-sm font-semibold text-amber-300">{flag.key}</code>
          <p className="mt-0.5 text-sm text-[var(--surface-muted)]">{flag.description}</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          {enabled ? '켜짐' : '꺼짐'}
        </label>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[10rem_1fr_auto]">
        <Field label="비율 (%)" hint="켜짐일 때만 의미가 있습니다.">
          <Input
            type="number"
            min={0}
            max={100}
            value={rollout}
            onChange={(event) => setRollout(Number(event.target.value))}
          />
        </Field>

        <Field label="항상 켤 채널 ID" hint="쉼표로 구분합니다. 비율과 무관하게 켜집니다.">
          <Input
            value={allowList}
            onChange={(event) => setAllowList(event.target.value)}
            placeholder="cuid1, cuid2"
          />
        </Field>

        <div className="flex items-end">
          <Button
            variant="secondary"
            size="sm"
            disabled={!dirty}
            onClick={() =>
              onSave({
                key: flag.key,
                description: flag.description,
                enabled,
                rolloutPercent: rollout,
                allowTenantIds: allowList
                  .split(',')
                  .map((value) => value.trim())
                  .filter(Boolean),
              })
            }
          >
            <Save className="size-4" />
            저장
          </Button>
        </div>
      </div>
    </Card>
  );
}
