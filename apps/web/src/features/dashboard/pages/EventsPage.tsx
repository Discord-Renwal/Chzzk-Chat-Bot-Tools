import { useState } from 'react';
import {
  AlertTriangle,
  Gift,
  MessagesSquare,
  Music,
  Radio,
  ShieldBan,
  Star,
  TerminalSquare,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Card, cn, EmptyState } from '@chzzk-bot/ui';
import { PageHeader } from '../components/Layout';
import { useEvents } from '../../../shared/api/bot';
import type { LogKind } from '../../../shared/types';

const KIND_STYLE: Record<LogKind, { icon: LucideIcon; color: string; label: string }> = {
  chat: { icon: MessagesSquare, color: 'text-[var(--surface-muted)]', label: '채팅' },
  command: { icon: TerminalSquare, color: 'text-brand', label: '명령어' },
  auto: { icon: MessagesSquare, color: 'text-sky-400', label: '자동응답' },
  moderation: { icon: ShieldBan, color: 'text-red-400', label: '제재' },
  donation: { icon: Gift, color: 'text-pink-400', label: '후원' },
  subscription: { icon: Star, color: 'text-amber-400', label: '구독' },
  song: { icon: Music, color: 'text-violet-400', label: '신청곡' },
  system: { icon: Radio, color: 'text-[var(--surface-muted)]', label: '시스템' },
  error: { icon: AlertTriangle, color: 'text-red-400', label: '오류' },
};

const FILTERS: { id: LogKind | 'all'; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'command', label: '명령어' },
  { id: 'moderation', label: '제재' },
  { id: 'donation', label: '후원' },
  { id: 'subscription', label: '구독' },
  { id: 'song', label: '신청곡' },
  { id: 'error', label: '오류' },
];

export function EventsPage() {
  const events = useEvents();
  const [filter, setFilter] = useState<LogKind | 'all'>('all');

  /*
   * 최신이 위로 오게 뒤집습니다.
   *
   * 서버는 시간순(오래된 것부터)으로 내려줍니다 — 폴링할 때 "이 id 이후" 를
   * 물어보려면 id 가 오름차순이어야 하기 때문입니다. 하지만 방송 중에 보는
   * 화면에서 방금 일어난 일이 맨 아래에 있으면 매번 스크롤해야 합니다.
   */
  const list = (events.data?.events ?? [])
    .filter((e) => filter === 'all' || e.kind === filter)
    .slice()
    .reverse();

  return (
    <>
      <PageHeader
        title="실시간 로그"
        description="봇이 방금 무엇을 했는지 보여줍니다. 요금제에 따라 3일~1년 보관되며, 지난 기록은 자동으로 지워집니다."
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-[13px] transition-colors',
              filter === id
                ? 'border-brand-600 bg-brand/10 text-brand-300'
                : 'border-[var(--surface-border)] text-[var(--surface-muted)] hover:text-[var(--surface-text)]'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <EmptyState icon={<Radio className="size-5" />} title="표시할 기록이 없습니다">
          봇이 실행 중이고 채팅이 오가면 여기에 실시간으로 쌓입니다.
        </EmptyState>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-[var(--surface-border)]">
            <AnimatePresence initial={false}>
              {list.map((entry) => {
                const style = KIND_STYLE[entry.kind];
                const Icon = style.icon;
                return (
                  <motion.li
                    key={entry.id}
                    layout
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-start gap-3 px-4 py-2.5"
                  >
                    <Icon className={cn('mt-0.5 size-4 shrink-0', style.color)} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug">
                        {entry.actor ? <b className="mr-1.5 font-semibold">{entry.actor}</b> : null}
                        <span className="text-[var(--surface-text)]">{entry.message}</span>
                      </p>
                      {entry.detail ? (
                        <p className="mt-0.5 truncate text-xs text-[var(--surface-muted)]">
                          {entry.detail}
                        </p>
                      ) : null}
                    </div>
                    <time className="shrink-0 text-xs tabular-nums text-[var(--surface-muted)]">
                      {new Date(entry.at).toLocaleTimeString('ko-KR', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </time>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        </Card>
      )}
    </>
  );
}
