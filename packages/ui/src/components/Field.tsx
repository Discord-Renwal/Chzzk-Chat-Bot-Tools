import { AlertCircle } from 'lucide-react';
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { useId } from 'react';
import { cn } from '../cn';

const CONTROL_CLASS = cn(
  'w-full rounded-lg border border-[var(--surface-border)] bg-[var(--surface-bg)]',
  'px-3 py-2 text-sm text-[var(--surface-text)] transition-colors',
  'placeholder:text-[var(--surface-muted)]/60',
  'focus-visible:focus-ring hover:border-[var(--color-ink-400)]',
  'disabled:cursor-not-allowed disabled:opacity-50'
);

interface FieldShellProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  children: ReactNode;
  className?: string;
}

/** 라벨 · 설명 · 오류 메시지를 일관되게 배치합니다. */
export function Field({ label, hint, error, children, className }: FieldShellProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label ? (
        <label className="block text-[13px] font-medium text-[var(--surface-text)]">{label}</label>
      ) : null}
      {children}
      {error ? (
        <p className="flex items-center gap-1.5 text-xs text-red-400">
          <AlertCircle className="size-3.5 shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs leading-relaxed text-[var(--surface-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL_CLASS, className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(CONTROL_CLASS, 'resize-y font-mono text-[13px]', className)}
      {...props}
    />
  );
}

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
}

/** 역할 선택처럼 여러 개를 고를 때 쓰는 칩 형태 체크박스 */
export function CheckChip({ label, className, ...props }: CheckboxProps) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        'inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5',
        'border-[var(--surface-border)] text-[13px] transition-colors',
        'hover:border-brand-600 has-checked:border-brand-600 has-checked:bg-brand/10',
        'has-checked:text-brand-300 has-focus-visible:focus-ring',
        className
      )}
    >
      <input id={id} type="checkbox" className="accent-brand size-3.5" {...props} />
      {label}
    </label>
  );
}
