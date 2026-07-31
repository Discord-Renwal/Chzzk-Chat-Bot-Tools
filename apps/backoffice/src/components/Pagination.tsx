import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@chzzk-bot/ui';

/**
 * 목록 페이지 이동.
 *
 * 페이지 번호를 전부 나열하지 않습니다. 사용자가 5000명이면 250개 버튼이 되고,
 * 어차피 관리자는 검색으로 찾지 페이지를 짚어 가지 않습니다.
 */
export function Pagination({
  page,
  totalPages,
  total,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (total === 0) {
    return <p className="py-8 text-center text-sm text-[var(--surface-muted)]">결과가 없습니다.</p>;
  }

  return (
    <div className="mt-4 flex items-center gap-3 border-t border-[var(--surface-border)] pt-3">
      <p className="text-xs text-[var(--surface-muted)]">
        전체 {total.toLocaleString('ko-KR')}건 · {page}/{totalPages} 페이지
      </p>

      <div className="ml-auto flex gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label="이전 페이지"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="다음 페이지"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
