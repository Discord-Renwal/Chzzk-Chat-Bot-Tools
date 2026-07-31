import * as Dialog from '@radix-ui/react-dialog';
import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { cn } from '../cn';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
}

/**
 * window.confirm 대신 쓰는 삭제 확인 창.
 * 브라우저 기본 창은 스타일을 맞출 수 없고, 포커스 관리도 Radix 쪽이 낫습니다.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = '삭제',
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-black/60 backdrop-blur-sm',
            'data-[state=open]:animate-in data-[state=open]:fade-in'
          )}
        />
        <Dialog.Content
          className={cn(
            'panel fixed left-1/2 top-1/2 z-50 w-[min(26rem,calc(100vw-2rem))]',
            '-translate-x-1/2 -translate-y-1/2 p-6 shadow-2xl',
            'data-[state=open]:animate-fade-up'
          )}
        >
          <div className="mb-3 grid size-10 place-items-center rounded-xl bg-red-500/10 text-red-400">
            <TriangleAlert className="size-5" />
          </div>
          <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
          {description ? (
            <Dialog.Description className="mt-1.5 text-sm leading-relaxed text-[var(--surface-muted)]">
              {description}
            </Dialog.Description>
          ) : null}

          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm">
                취소
              </Button>
            </Dialog.Close>
            <Button
              size="sm"
              className="bg-red-500 text-white hover:bg-red-400"
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
