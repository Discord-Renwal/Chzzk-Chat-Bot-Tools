import { Slot, Slottable } from '@radix-ui/react-slot';
import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'icon';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand text-brand-ink font-semibold hover:bg-brand-400 active:bg-brand-600 shadow-[0_1px_0_0_rgb(255_255_255/0.25)_inset]',
  secondary:
    'bg-[var(--surface-raised)] text-[var(--surface-text)] hover:brightness-110 border border-[var(--surface-border)]',
  ghost:
    'text-[var(--surface-muted)] hover:text-[var(--surface-text)] hover:bg-[var(--surface-raised)]',
  danger:
    'text-red-400 hover:bg-red-500/10 hover:text-red-300 border border-transparent hover:border-red-500/30',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-9.5 px-4 text-sm gap-2',
  icon: 'size-8 justify-center',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** true 면 자식 엘리먼트에 스타일만 입힙니다 (Radix Slot) */
  asChild?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  asChild = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      className={cn(
        'inline-flex items-center rounded-lg transition-all duration-150',
        'focus-visible:focus-ring disabled:pointer-events-none disabled:opacity-50',
        'cursor-pointer select-none whitespace-nowrap',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      disabled={disabled ?? loading}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : null}
      {/*
       * `Slottable` 로 감싸야 `asChild` 가 동작합니다.
       *
       * Slot 은 자식이 **정확히 하나**여야 하는데, 위 스피너 자리가 `null` 이어도
       * children 배열의 길이는 2 입니다. 감싸지 않으면 Slot 이
       * "Expected a single React element child" 로 던지고, 그 순간 React 트리
       * 전체가 마운트에 실패합니다 — 버튼 하나 때문에 화면이 통째로 하얘집니다.
       */}
      <Slottable>{children}</Slottable>
    </Comp>
  );
}
