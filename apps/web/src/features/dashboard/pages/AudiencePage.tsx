import { Heart, Star, UserPlus } from 'lucide-react';
import { Badge, Card, CardTitle, EmptyState } from '@chzzk-bot/ui';
import { PageHeader } from '../components/Layout';
import { useAudience } from '../../../shared/api/bot';

export function AudiencePage() {
  const audience = useAudience();

  const followers = audience.data?.followers ?? [];
  const subscribers = audience.data?.subscribers ?? [];

  return (
    <>
      <PageHeader
        title="팔로워 · 구독자"
        description={
          <>
            치지직에서 직접 받아온 목록입니다. 각 최신 50명까지 보여줍니다. 팔로우{' '}
            <b className="text-[var(--surface-text)]">알림</b>은 API 에 이벤트가 없어 만들 수
            없습니다 — 이 화면은 조회 전용입니다.
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle hint={audience.data?.followersError ?? undefined}>
            <span className="flex items-center gap-2">
              <Heart className="size-4 text-pink-400" />
              팔로워 {followers.length > 0 ? `${followers.length}명` : ''}
            </span>
          </CardTitle>

          {audience.data?.followersError ? (
            <p className="text-sm text-[var(--surface-muted)]">{audience.data.followersError}</p>
          ) : followers.length === 0 ? (
            <EmptyState icon={<UserPlus className="size-5" />} title="팔로워가 없습니다" />
          ) : (
            <ul className="space-y-1.5">
              {followers.map((follower) => (
                <li key={follower.channelId} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{follower.channelName}</span>
                  <span className="shrink-0 text-xs text-[var(--surface-muted)]">
                    {formatDate(follower.createdDate)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>
            <span className="flex items-center gap-2">
              <Star className="size-4 text-amber-400" />
              구독자 {subscribers.length > 0 ? `${subscribers.length}명` : ''}
            </span>
          </CardTitle>

          {audience.data?.subscribersError ? (
            <p className="text-sm text-[var(--surface-muted)]">{audience.data.subscribersError}</p>
          ) : subscribers.length === 0 ? (
            <EmptyState icon={<Star className="size-5" />} title="구독자가 없습니다">
              구독자 목록이 있어야 명령어의 <b>구독자 전용</b> 옵션이 동작합니다.
            </EmptyState>
          ) : (
            <ul className="space-y-1.5">
              {subscribers.map((subscriber) => (
                <li key={subscriber.channelId} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{subscriber.channelName}</span>
                  <Badge tone="brand">티어{subscriber.tierNo}</Badge>
                  <span className="shrink-0 text-xs text-[var(--surface-muted)]">
                    {subscriber.month}개월
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function formatDate(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
}
