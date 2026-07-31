import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, Field, Input, Select, Textarea } from '@chzzk-bot/ui';
import { PageHeader } from '../app/ConsoleLayout';
import { useAnnouncements, useCreateAnnouncement, useDeleteAnnouncement } from '../shared/api';

const LEVELS = [
  ['INFO', '안내'],
  ['WARNING', '주의'],
  ['CRITICAL', '긴급'],
] as const;

/**
 * 공지 (요구사항 3번).
 *
 * 발행 시각을 비우면 초안으로 저장됩니다. 점검 공지를 미리 써 두고 시간이 되면
 * 발행하는 흐름이 가장 흔한데, 초안 개념이 없으면 그때마다 급하게 작성하게 됩니다.
 */
export function AnnouncementsPage() {
  const announcements = useAnnouncements();
  const create = useCreateAnnouncement();
  const remove = useDeleteAnnouncement();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [level, setLevel] = useState('INFO');
  const [publishNow, setPublishNow] = useState(true);

  const canSubmit = title.trim().length > 0 && body.trim().length > 0;

  return (
    <div>
      <PageHeader title="공지" description="사용자에게 보여줄 안내를 관리합니다." />

      <Card>
        <h2 className="font-semibold">새 공지</h2>

        <div className="mt-4 grid gap-3">
          <Field label="제목">
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="예: 2월 3일 새벽 정기 점검 안내"
              maxLength={120}
            />
          </Field>

          <Field label="내용">
            <Textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={4}
              maxLength={4000}
            />
          </Field>

          <div className="flex flex-wrap items-end gap-3">
            <Field label="중요도" className="w-40">
              <Select aria-label="중요도" value={level} onValueChange={setLevel} options={LEVELS} />
            </Field>

            <label className="flex items-center gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={publishNow}
                onChange={(event) => setPublishNow(event.target.checked)}
                className="size-4 accent-amber-500"
              />
              바로 발행 (끄면 초안으로 저장)
            </label>

            <Button
              size="sm"
              className="ml-auto"
              disabled={!canSubmit}
              loading={create.isPending}
              onClick={() => {
                create.mutate({
                  title,
                  body,
                  level,
                  publishedAt: publishNow ? new Date().toISOString() : null,
                  expiresAt: null,
                });
                setTitle('');
                setBody('');
              }}
            >
              <Plus className="size-4" />
              등록
            </Button>
          </div>
        </div>
      </Card>

      <Card className="mt-4">
        <h2 className="font-semibold">등록된 공지</h2>

        {announcements.isPending ? (
          <div className="flex justify-center py-8 text-[var(--surface-muted)]">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (announcements.data?.announcements.length ?? 0) === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--surface-muted)]">
            등록된 공지가 없습니다.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--surface-border)]/50">
            {announcements.data?.announcements.map((item) => (
              <li key={item.id} className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{item.title}</p>
                    <Badge
                      className={
                        item.level === 'CRITICAL'
                          ? 'border-red-500/40 text-red-400'
                          : item.level === 'WARNING'
                            ? 'border-amber-500/40 text-amber-400'
                            : undefined
                      }
                    >
                      {LEVELS.find(([value]) => value === item.level)?.[1] ?? item.level}
                    </Badge>
                    {item.publishedAt ? null : <Badge>초안</Badge>}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--surface-muted)]">
                    {item.body}
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--surface-muted)]">
                    {item.publishedAt
                      ? `${new Date(item.publishedAt).toLocaleString('ko-KR')} 발행`
                      : `${new Date(item.createdAt).toLocaleString('ko-KR')} 작성`}
                  </p>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="공지 삭제"
                  onClick={() => remove.mutate(item.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
