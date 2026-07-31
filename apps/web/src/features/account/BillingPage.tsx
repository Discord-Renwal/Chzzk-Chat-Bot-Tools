import { CreditCard, Loader2, Plus, Receipt, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Card, CardTitle, ConfirmDialog, EmptyState } from '@chzzk-bot/ui';
import {
  useBillingCards,
  useBillingConfig,
  usePayments,
  useRegisterCard,
  useRemoveCard,
} from '../../shared/api/billing';
import { useSession } from '../../shared/api/session';
import { issueBillingKey, issueMockBillingKey } from '../../shared/portone';
import { PAYMENT_STATUS_LABELS } from '../../shared/types';

/**
 * 결제 수단과 결제 내역 (요구사항 1번).
 *
 * 카드번호는 앞 6 · 뒤 4 만 보여줍니다. 그 이상은 우리 DB 에도 없습니다 —
 * 브라우저가 PG 창에서 직접 입력하고 우리는 빌링키만 받기 때문입니다.
 */
export function BillingPage() {
  const cards = useBillingCards();
  const payments = usePayments();
  const config = useBillingConfig();
  const session = useSession();

  const registerCard = useRegisterCard();
  const removeCard = useRemoveCard();

  const [adding, setAdding] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);

  const user = session.data?.user;

  async function addCard(): Promise<void> {
    if (!user || !config.data) return;

    setAdding(true);
    try {
      const issued =
        config.data.provider === 'mock'
          ? issueMockBillingKey(user.id)
          : await issueBillingKey({
              storeId: config.data.storeId,
              channelKey: config.data.channelKey,
              customerId: user.id,
              customerName: user.channelName,
              planName: '결제 수단',
            });

      await registerCard.mutateAsync(issued.issueId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '카드를 등록하지 못했습니다.');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">결제</h1>

      {/* ─── 결제 수단 ─── */}
      <Card className="mt-6">
        <div className="flex items-center gap-2">
          <CreditCard className="size-4 text-brand" />
          <CardTitle>결제 수단</CardTitle>
        </div>

        {cards.isPending ? (
          <Loader2 className="mt-4 size-4 animate-spin text-[var(--surface-muted)]" />
        ) : (cards.data?.cards.length ?? 0) === 0 ? (
          <p className="mt-3 text-sm text-[var(--surface-muted)]">
            등록된 카드가 없습니다. 유료 요금제를 쓰려면 카드를 등록해 주세요.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {cards.data?.cards.map((card) => (
              <li
                key={card.id}
                className="flex items-center gap-3 rounded-lg border border-[var(--surface-border)] p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{card.issuer}</p>
                  <p className="mt-0.5 font-mono text-xs text-[var(--surface-muted)]">
                    {card.maskedNumber}
                  </p>
                </div>
                {card.isDefault ? <Badge>기본</Badge> : null}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="카드 삭제"
                  onClick={() => setPendingRemoval(card.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          loading={adding}
          onClick={() => void addCard()}
        >
          <Plus className="size-4" />
          카드 등록
        </Button>

        <p className="mt-3 text-xs leading-relaxed text-[var(--surface-muted)]">
          카드 정보는 결제 대행사(PortOne)가 보관하며, 저희 서버에는 저장되지 않습니다.
        </p>
      </Card>

      {/* ─── 결제 내역 ─── */}
      <Card className="mt-6">
        <div className="flex items-center gap-2">
          <Receipt className="size-4 text-brand" />
          <CardTitle>결제 내역</CardTitle>
        </div>

        {payments.isPending ? (
          <Loader2 className="mt-4 size-4 animate-spin text-[var(--surface-muted)]" />
        ) : (payments.data?.payments.length ?? 0) === 0 ? (
          <EmptyState title="결제 내역이 없습니다">
            <p>유료 요금제를 시작하면 여기에 표시됩니다.</p>
          </EmptyState>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--surface-border)] text-left text-xs text-[var(--surface-muted)]">
                  <th className="pb-2 font-medium">일시</th>
                  <th className="pb-2 font-medium">내용</th>
                  <th className="pb-2 text-right font-medium">금액</th>
                  <th className="pb-2 text-right font-medium">상태</th>
                </tr>
              </thead>
              <tbody>
                {payments.data?.payments.map((payment) => (
                  <tr key={payment.id} className="border-b border-[var(--surface-border)]/50">
                    <td className="py-2.5 text-[var(--surface-muted)]">
                      {formatDateTime(payment.paidAt ?? payment.createdAt)}
                    </td>
                    <td className="py-2.5">
                      {payment.orderName}
                      {payment.failureReason ? (
                        <span className="ml-2 text-xs text-red-400">{payment.failureReason}</span>
                      ) : null}
                    </td>
                    <td className="py-2.5 text-right tabular-nums">
                      {payment.amount.toLocaleString('ko-KR')}원
                      {payment.refundedAmount > 0 ? (
                        <span className="ml-1 text-xs text-[var(--surface-muted)]">
                          (−{payment.refundedAmount.toLocaleString('ko-KR')})
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2.5 text-right">
                      {payment.receiptUrl ? (
                        <a
                          href={payment.receiptUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand hover:underline"
                        >
                          {PAYMENT_STATUS_LABELS[payment.status]}
                        </a>
                      ) : (
                        <span className="text-[var(--surface-muted)]">
                          {PAYMENT_STATUS_LABELS[payment.status]}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => !open && setPendingRemoval(null)}
        title="이 카드를 삭제할까요?"
        description="이 카드로 자동 결제되던 구독이 있다면 다음 결제일에 실패합니다."
        onConfirm={() => {
          if (pendingRemoval) removeCard.mutate(pendingRemoval);
          setPendingRemoval(null);
        }}
      />
    </div>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
