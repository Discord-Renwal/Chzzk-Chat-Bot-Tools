import * as RadixSelect from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../cn';

interface SelectProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly (readonly [T, string])[];
  className?: string;
  'aria-label'?: string;
}

/** 네이티브 select 와 달리 목록 스타일을 브랜드에 맞출 수 있습니다. */
export function Select<T extends string>({
  value,
  onValueChange,
  options,
  className,
  ...props
}: SelectProps<T>) {
  return (
    <RadixSelect.Root value={value} onValueChange={(v) => onValueChange(v as T)}>
      <RadixSelect.Trigger
        aria-label={props['aria-label']}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2',
          'border-[var(--surface-border)] bg-[var(--surface-bg)] text-sm',
          'cursor-pointer transition-colors hover:border-[var(--color-ink-400)]',
          'focus-visible:focus-ring data-[state=open]:border-brand-600',
          className
        )}
      >
        <RadixSelect.Value />
        <RadixSelect.Icon>
          <ChevronDown className="size-4 text-[var(--surface-muted)]" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={6}
          className={cn(
            'z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg',
            'border border-[var(--surface-border)] bg-[var(--surface-panel)] p-1 shadow-xl',
            'data-[state=open]:animate-fade-up'
          )}
        >
          <RadixSelect.Viewport>
            {options.map(([optionValue, label]) => (
              <RadixSelect.Item
                key={optionValue}
                value={optionValue}
                className={cn(
                  'relative flex cursor-pointer select-none items-center gap-2 rounded-md',
                  'py-1.5 pl-7 pr-3 text-sm outline-none',
                  'data-[highlighted]:bg-[var(--surface-raised)] data-[state=checked]:text-brand'
                )}
              >
                <RadixSelect.ItemIndicator className="absolute left-2">
                  <Check className="size-3.5" />
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
