import { useState } from 'react';
import { Info } from 'lucide-react';
import { Button, Card, CardTitle, Field, Select, Switch } from '@chzzk-bot/ui';
import { PageHeader } from '../components/Layout';
import { StreamerOnly } from '../components/StreamerOnly';
import { useChatSettings, useSaveChatSettings } from '../../../shared/api/bot';
import type { ChatSettings } from '../../../shared/types';

/** 문서가 정한 허용값. 그 외 값은 API 가 거절합니다. */
const SLOW_MODES: readonly (readonly [string, string])[] = [
  ['0', '해제'],
  ['3', '3초'],
  ['5', '5초'],
  ['10', '10초'],
  ['30', '30초'],
  ['60', '1분'],
  ['120', '2분'],
  ['300', '5분'],
];

const FOLLOW_MINUTES: readonly (readonly [string, string])[] = [
  ['0', '제한 없음'],
  ['5', '5분'],
  ['10', '10분'],
  ['30', '30분'],
  ['60', '1시간'],
  ['1440', '1일'],
  ['10080', '7일'],
  ['43200', '30일'],
  ['86400', '60일'],
  ['129600', '90일'],
  ['172800', '120일'],
  ['216000', '150일'],
  ['259200', '180일'],
];

const GROUPS: readonly (readonly [ChatSettings['chatAvailableGroup'], string])[] = [
  ['ALL', '전체'],
  ['FOLLOWER', '팔로워'],
  ['SUBSCRIBER', '구독자'],
  ['MANAGER', '매니저'],
];

const CONDITIONS: readonly (readonly [ChatSettings['chatAvailableCondition'], string])[] = [
  ['NONE', '제한 없음'],
  ['REAL_NAME', '본인인증 완료자만'],
];

export function ChatSettingsPage() {
  const settings = useChatSettings();
  const save = useSaveChatSettings();

  /**
   * 서버 값을 effect 로 로컬 state 에 복사하면 새로 받아올 때마다 렌더가 연쇄됩니다.
   * 대신 "사용자가 바꾼 부분" 만 들고 있다가 서버 값 위에 덮어 보여줍니다.
   * 저장 후 서버 값이 갱신되면 override 만 비우면 됩니다.
   */
  const [override, setOverride] = useState<Partial<ChatSettings> | null>(null);
  const draft = settings.data ? { ...settings.data, ...override } : null;

  const patch = <K extends keyof ChatSettings>(key: K, value: ChatSettings[K]) =>
    setOverride((prev) => ({ ...prev, [key]: value }));

  const dirty =
    override !== null && settings.data !== undefined
      ? JSON.stringify(draft) !== JSON.stringify(settings.data)
      : false;

  return (
    <>
      <PageHeader
        title="채팅 설정"
        description="치지직 채널의 채팅 참여 조건을 바꿉니다. 이 화면의 값은 봇 설정이 아니라 채널에 직접 반영됩니다."
      />

      <StreamerOnly isPending={settings.isPending} error={settings.error}>
        {draft ? (
          <Card>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                save.mutate(draft, { onSuccess: () => setOverride(null) });
              }}
              className="space-y-5"
            >
              <CardTitle>참여 조건</CardTitle>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="채팅 참여 대상" hint="채팅에서 !채팅모드 로도 바꿀 수 있습니다.">
                  <Select
                    value={draft.chatAvailableGroup}
                    onValueChange={(v) => patch('chatAvailableGroup', v)}
                    options={GROUPS}
                    aria-label="채팅 참여 대상"
                  />
                </Field>

                <Field
                  label="본인인증 조건"
                  hint="네이버 본인인증을 마친 사용자만 채팅할 수 있게 합니다."
                >
                  <Select
                    value={draft.chatAvailableCondition}
                    onValueChange={(v) => patch('chatAvailableCondition', v)}
                    options={CONDITIONS}
                    aria-label="본인인증 조건"
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="최소 팔로우 기간"
                  hint="팔로워 모드일 때, 이만큼 팔로우한 사람부터 채팅할 수 있습니다."
                >
                  <Select
                    value={String(draft.minFollowerMinute)}
                    onValueChange={(v) => patch('minFollowerMinute', Number(v))}
                    options={FOLLOW_MINUTES}
                    aria-label="최소 팔로우 기간"
                  />
                </Field>

                <Field label="슬로우 모드" hint="시청자가 채팅을 보내는 간격입니다.">
                  <Select
                    value={String(draft.chatSlowModeSec)}
                    onValueChange={(v) => patch('chatSlowModeSec', Number(v))}
                    options={SLOW_MODES}
                    aria-label="슬로우 모드"
                  />
                </Field>
              </div>

              <Switch
                checked={draft.allowSubscriberInFollowerMode}
                onCheckedChange={(v) => patch('allowSubscriberInFollowerMode', v)}
                label="팔로워 모드에서 구독자는 예외"
                hint="팔로우 기간이 부족해도 구독자는 채팅할 수 있게 합니다."
              />

              <Switch
                checked={draft.chatEmojiMode}
                onCheckedChange={(v) => patch('chatEmojiMode', v)}
                label="이모티콘 전용 모드"
                hint="켜면 글자 없이 이모티콘만 보낼 수 있습니다."
              />

              <p className="flex items-start gap-2 rounded-lg border border-[var(--surface-border)] px-3 py-2.5 text-xs leading-relaxed text-[var(--surface-muted)]">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                슬로우 모드와 최소 팔로우 기간은 치지직이 정한 값만 쓸 수 있어 목록에서 고르게
                했습니다. 다른 값을 보내면 API 가 거절합니다.
              </p>

              <div className="flex items-center gap-2">
                <Button type="submit" variant="primary" size="sm" loading={save.isPending}>
                  저장
                </Button>
                {dirty ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setOverride(null)}>
                    되돌리기
                  </Button>
                ) : null}
              </div>
            </form>
          </Card>
        ) : null}
      </StreamerOnly>
    </>
  );
}
