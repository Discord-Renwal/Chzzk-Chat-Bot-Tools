import * as RadixSwitch from '@radix-ui/react-switch';
import type { ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '../cn';

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
  hint?: ReactNode;
  className?: string;
}

/**
 * Radix Switch 를 쓰는 이유는 접근성입니다 — role="switch", 키보드 조작,
 * aria-checked 를 직접 구현하지 않아도 됩니다.
 */
export function Switch({ checked, onCheckedChange, label, hint, className }: SwitchProps) {
  const id = useId();

  const control = (
    <RadixSwitch.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      className={cn(
        'relative h-5.5 w-10 shrink-0 cursor-pointer rounded-full transition-colors duration-200',
        'bg-[var(--surface-border)] data-[state=checked]:bg-brand',
        'focus-visible:focus-ring'
      )}
    >
      <RadixSwitch.Thumb
        className={cn(
          'block size-4.5 rounded-full bg-white shadow-sm transition-transform duration-200',
          'translate-x-0.5 will-change-transform data-[state=checked]:translate-x-[1.125rem]'
        )}
      />
    </RadixSwitch.Root>
  );

  if (!label) return <div className={className}>{control}</div>;

  return (
    <div className={cn('flex items-start gap-3', className)}>
      {control}
      <div className="min-w-0">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium">
          {label}
        </label>
        {hint ? (
          <p className="mt-0.5 text-xs leading-relaxed text-[var(--surface-muted)]">{hint}</p>
        ) : null}
      </div>
    </div>
  );
}
