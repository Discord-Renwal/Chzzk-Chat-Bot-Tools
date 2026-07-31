import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { cn } from '@chzzk-bot/ui';

interface ListEditorProps {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
}

/**
 * `!멤버` 같은 목록형 명령의 항목 편집기.
 *
 * 쉼표로 붙여 넣는 방식(`빅헤드,9구진`)도 그대로 받습니다 — 채팅에서 쓰던 방식과
 * 대시보드가 다르게 동작하면 헷갈리기 때문입니다.
 */
export function ListEditor({
  items,
  onChange,
  placeholder = '이름 입력 후 Enter',
}: ListEditorProps) {
  const [draft, setDraft] = useState('');

  function commit() {
    const parts = draft
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;

    const existing = new Set(items.map((i) => i.toLowerCase()));
    const added = parts.filter((p) => !existing.has(p.toLowerCase()));

    if (added.length > 0) onChange([...items, ...added]);
    setDraft('');
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
      return;
    }
    // 입력칸이 비어 있을 때 백스페이스로 마지막 항목을 지웁니다.
    if (event.key === 'Backspace' && draft === '' && items.length > 0) {
      onChange(items.slice(0, -1));
    }
  }

  return (
    <div className="space-y-2">
      <div
        className={cn(
          'flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg border p-1.5',
          'border-[var(--surface-border)] bg-[var(--surface-bg)]',
          'focus-within:border-brand-600'
        )}
      >
        <AnimatePresence initial={false}>
          {items.map((item, index) => (
            <motion.span
              key={`${item}-${index}`}
              layout
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.14 }}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2 py-1',
                'border-brand-600/40 bg-brand/10 text-[13px] text-brand-300'
              )}
            >
              {item}
              <button
                type="button"
                aria-label={`${item} 삭제`}
                onClick={() => onChange(items.filter((_, i) => i !== index))}
                className="rounded-sm opacity-60 transition-opacity hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            </motion.span>
          ))}
        </AnimatePresence>

        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commit}
          placeholder={items.length === 0 ? placeholder : ''}
          className="min-w-32 flex-1 bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-[var(--surface-muted)]/60"
        />
      </div>

      <div className="flex items-center justify-between text-xs text-[var(--surface-muted)]">
        <span>
          쉼표로 여러 개를 한 번에 넣을 수 있습니다 · 총{' '}
          <b className="text-brand">{items.length}</b>개
        </span>
        {items.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="transition-colors hover:text-red-400"
          >
            전체 비우기
          </button>
        ) : null}
      </div>
    </div>
  );
}
