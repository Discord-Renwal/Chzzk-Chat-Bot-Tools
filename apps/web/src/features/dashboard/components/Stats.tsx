import { useEffect, useRef, useState } from 'react';
import { Activity, MessageCircle, ShieldBan, Sparkles, TerminalSquare } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card, cn } from '@chzzk-bot/ui';
import type { BotStats } from '../../../shared/types';

/**
 * 폴링해 온 누적값의 차분을 모아 최근 추세를 그립니다.
 *
 * 차트 라이브러리를 쓰지 않은 이유: 서버가 시계열을 보관하지 않아 그릴 데이터가
 * 브라우저에 쌓인 30개 남짓의 점뿐입니다. 축·범례·툴팁이 필요 없는 그래프 하나에
 * 수십 KB를 더할 이유가 없어 SVG 폴리라인으로 직접 그렸습니다.
 */
function Sparkline({ points, className }: { points: number[]; className?: string }) {
  // 값이 전부 0이면 바닥에 붙은 직선 하나만 남습니다. 정보가 없는데 시선은
  // 끌기 때문에, 채팅이 한 번이라도 오갈 때까지는 아예 그리지 않습니다.
  if (points.length < 2 || points.every((value) => value === 0)) {
    return <div className={cn('h-8', className)} />;
  }

  const max = Math.max(...points, 1);
  const step = 100 / (points.length - 1);
  const coords = points.map((value, index) => [index * step, 28 - (value / max) * 24] as const);
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `0,28 ${line} 100,28`;

  return (
    <svg
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      className={cn('h-8 w-full', className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#sparkFill)" />
      <polyline
        points={line}
        fill="none"
        stroke="var(--color-brand)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  accent = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-bg)] p-4">
      <div className="mb-2 flex items-center gap-2 text-[var(--surface-muted)]">
        <Icon className={cn('size-4', accent && 'text-brand')} />
        <span className="text-xs">{label}</span>
      </div>
      <p className={cn('text-2xl font-semibold tabular-nums', accent && 'text-brand')}>{value}</p>
    </div>
  );
}

function formatUptime(startedAt: number): string {
  const minutes = Math.floor((Date.now() - startedAt) / 60_000);
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 ${minutes % 60}분`;
  return `${Math.floor(hours / 24)}일 ${hours % 24}시간`;
}

export function StatsPanel({ stats }: { stats: BotStats | null }) {
  const [history, setHistory] = useState<number[]>([]);
  const previous = useRef<number | null>(null);

  useEffect(() => {
    if (!stats) return;
    const last = previous.current;
    previous.current = stats.messagesSeen;
    if (last === null) return;

    setHistory((prev) => [...prev, Math.max(0, stats.messagesSeen - last)].slice(-30));
  }, [stats]);

  if (!stats) {
    return (
      <Card>
        <p className="text-sm text-[var(--surface-muted)]">
          봇이 실행 중이 아닙니다. 터미널에서 <code className="text-brand">pnpm bot</code> 을
          실행하세요. 설정 편집은 지금도 가능합니다.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-[15px] font-semibold">실행 현황</h3>
          <p className="mt-0.5 text-xs text-[var(--surface-muted)]">
            {formatUptime(stats.startedAt)} 가동 중
            {stats.lastChatAt
              ? ` · 마지막 채팅 ${new Date(stats.lastChatAt).toLocaleTimeString('ko-KR')}`
              : ' · 아직 채팅 없음'}
          </p>
        </div>
        <div className="w-28">
          <Sparkline points={history} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile icon={MessageCircle} label="본 메시지" value={stats.messagesSeen} accent />
        <StatTile icon={TerminalSquare} label="실행한 명령" value={stats.commandsRun} />
        <StatTile icon={Sparkles} label="자동응답" value={stats.autoResponsesSent} />
        <StatTile icon={ShieldBan} label="제재 조치" value={stats.moderationActions} />
      </div>

      {history.length >= 2 && history.some((value) => value > 0) ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--surface-muted)]">
          <Activity className="size-3.5" />
          그래프는 브라우저를 연 뒤 4초마다 집계한 채팅 수입니다.
        </p>
      ) : null}
    </Card>
  );
}
