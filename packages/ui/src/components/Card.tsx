import type { ReactNode } from 'react';
import { cn } from '../cn';

interface CardProps {
  children: ReactNode;
  className?: string;
  /** 비활성 항목을 흐리게 */
  dimmed?: boolean;
}

export function Card({ children, className, dimmed = false }: CardProps) {
  return (
    <section
      className={cn(
        'panel p-5 transition-opacity',
        dimmed && 'opacity-55 hover:opacity-80',
        className
      )}
    >
      {children}
    </section>
  );
}

export function CardTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="text-[15px] font-semibold">{children}</h3>
      {hint ? (
        <p className="mt-1 text-xs leading-relaxed text-[var(--surface-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}

type Tone = 'neutral' | 'brand' | 'warn';

const TONES: Record<Tone, string> = {
  neutral: 'border-[var(--surface-border)] text-[var(--surface-muted)]',
  brand: 'border-brand-600/40 bg-brand/10 text-brand-300',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: Tone | undefined;
  className?: string | undefined;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5',
        'text-[11px] font-medium leading-5',
        TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/**
 * 아직 만들지 않은 기능 안내처럼, 본문이 비어 있을 때 쓰는 자리.
 *
 * 아이콘은 선택입니다. "결제 내역이 없습니다" 처럼 문장만으로 충분한 자리에
 * 억지로 그림을 넣으면 오히려 시선을 뺏깁니다.
 */
export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="panel flex flex-col items-center px-6 py-12 text-center">
      {icon ? (
        <div className="mb-3 grid size-11 place-items-center rounded-xl bg-[var(--surface-raised)] text-[var(--surface-muted)]">
          {icon}
        </div>
      ) : null}
      <h3 className="text-sm font-semibold">{title}</h3>
      {children ? (
        <div className="mt-1.5 max-w-md text-[13px] leading-relaxed text-[var(--surface-muted)]">
          {children}
        </div>
      ) : null}
    </div>
  );
}
