import { useState } from 'react';
import { Plus, ShieldBan, ShieldCheck } from 'lucide-react';
import {
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
import { BannedWordCard } from '../components/BannedWordCard';
import { ROLES } from '../../../shared/constants';
import type { BotConfig, UserRoleCodeValue } from '../../../shared/types';
import { useCreateBannedWord, useSaveSection } from '../../../shared/api/bot';

export function BannedWordsPage({ config }: { config: BotConfig }) {
  const [pattern, setPattern] = useState('');
  const create = useCreateBannedWord();
  const save = useSaveSection('moderation');

  const { enabled, allowTempBan, exemptRoles, words } = config.moderation;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = pattern.trim();
    if (!trimmed) return;
    create.mutate({ pattern: trimmed }, { onSuccess: () => setPattern('') });
  }

  function toggleExempt(role: UserRoleCodeValue, checked: boolean) {
    save.mutate({
      enabled,
      allowTempBan,
      exemptRoles: checked ? [...exemptRoles, role] : exemptRoles.filter((r) => r !== role),
    });
  }

  return (
    <>
      <PageHeader
        title="금칙어 설정"
        description="금칙어 검사는 명령어보다 먼저 실행됩니다. 명령어 인자에 금칙어를 숨겨 보내는 우회를 막기 위해서입니다."
      />

      <Card className="mb-4">
        <CardTitle>동작 방식</CardTitle>
        <div className="space-y-4">
          <Switch
            checked={enabled}
            onCheckedChange={(v) => save.mutate({ enabled: v, allowTempBan, exemptRoles })}
            label="금칙어 기능 사용"
          />

          <Switch
            checked={allowTempBan}
            onCheckedChange={(v) => save.mutate({ enabled, allowTempBan: v, exemptRoles })}
            label="임시 제한 조치 허용"
            hint="꺼두면 '숨기고 임시제한' 규칙도 숨기기까지만 실행합니다. 실수로 시청자를 막는 일을 피하려면 확인 후 켜세요."
          />

          <Field
            label="검사에서 제외할 역할"
            hint="여기 포함된 역할은 금칙어를 써도 걸리지 않습니다."
          >
            <div className="flex flex-wrap gap-1.5">
              {ROLES.map(([value, label]) => (
                <CheckChip
                  key={value}
                  label={label}
                  checked={exemptRoles.includes(value)}
                  onChange={(e) => toggleExempt(value, e.target.checked)}
                />
              ))}
            </div>
          </Field>
        </div>
      </Card>

      <Card className="mb-4">
        <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="금칙어 추가" className="flex-1">
            <Input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="차단할 단어"
            />
          </Field>
          <Button
            type="submit"
            variant="primary"
            loading={create.isPending}
            disabled={pattern.trim() === ''}
          >
            <Plus className="size-4" />
            추가
          </Button>
        </form>
      </Card>

      {words.length === 0 ? (
        <EmptyState icon={<ShieldCheck className="size-5" />} title="등록된 금칙어가 없습니다">
          지금은 어떤 메시지도 차단되지 않습니다.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {!enabled ? (
            <p className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-[13px] text-amber-300">
              <ShieldBan className="size-4 shrink-0" />
              금칙어 기능이 꺼져 있어 아래 규칙은 동작하지 않습니다.
            </p>
          ) : null}
          {words.map((word) => (
            <BannedWordCard key={word.id} word={word} tempBanAllowed={allowTempBan} />
          ))}
        </div>
      )}
    </>
  );
}
