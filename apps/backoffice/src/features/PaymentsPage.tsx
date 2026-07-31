import { Loader2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { PAYMENT_STATUS_LABELS, type PaymentStatus } from '@chzzk-bot/contracts';
import { Button, Card, Field, Input, Select, Textarea } from '@chzzk-bot/ui';
import { PageHeader } from '../app/ConsoleLayout';
import { Pagination } from '../components/Pagination';
import { usePayments, useRefund, type AdminPaymentRow } from '../shared/api';

const STATUS_OPTIONS = [
  ['', '전체'],
  ['PAID', '결제 완료'],
  ['FAILED', '결제 실패'],
  ['PARTIAL_REFUNDED', '부분 환불'],
  ['REFUNDED', '환불 완료'],
] as const;

/**
 * 결제 내역과 환불 (요구사항 3번).
 *
 * 환불은 돈이 나가는 동작이라 운영자 이상만 가능하고, 금액을 비우면 전액입니다.
 * 부분 환불 금액을 잘못 넣는 실수를 막기 위해 환불 가능액을 함께 보여줍니다.
 */
export function PaymentsPage() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<AdminPaymentRow | null>(null);

  const payments = usePayments({ status: status || undefined, page });

  return (
    <div>
      <PageHeader title="결제" description="결제·환불 내역입니다. 금액은 원(KRW)입니다." />

      <Card>
        <Select
          aria-label="상태 필터"
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          options={STATUS_OPTIONS}
          className="w-44"
        />
      </Card>

      <Card className="mt-4">
        {payments.isPending ? (
          <div className="flex justify-center py-12 text-[var(--surface-muted)]">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : payments.isError ? (
          <p className="py-8 text-center text-sm text-red-400">{payments.error.message}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--surface-border)] text-left text-xs text-[var(--surface-muted)]">
                    <th className="pb-2 font-medium">일시</th>
                    <th className="pb-2 font-medium">채널</th>
                    <th className="pb-2 font-medium">내용</th>
                    <th className="pb-2 text-right font-medium">금액</th>
                    <th className="pb-2 font-medium">상태</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {payments.data?.data.map((payment) => (
                    <tr key={payment.id} className="border-b border-[var(--surface-border)]/50">
                      <td className="py-2.5 text-[var(--surface-muted)]">
                        {new Date(payment.paidAt ?? payment.createdAt).toLocaleString('ko-KR', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="py-2.5">{payment.tenant.channelName}</td>
                      <td className="py-2.5">
                        {payment.orderName}
                        {payment.failureReason ? (
                          <span className="ml-2 text-xs text-red-400">{payment.failureReason}</span>
                        ) : null}
                      </td>
                      <td className="py-2.5 text-right tabular-nums">
                        {payment.amount.toLocaleString('ko-KR')}
                        {payment.refundedAmount > 0 ? (
                          <span className="ml-1 text-xs text-[var(--surface-muted)]">
                            (−{payment.refundedAmount.toLocaleString('ko-KR')})
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2.5 text-[var(--surface-muted)]">
                        {PAYMENT_STATUS_LABELS[payment.status as PaymentStatus] ?? payment.status}
                      </td>
                      <td className="py-2.5 text-right">
                        {payment.status === 'PAID' || payment.status === 'PARTIAL_REFUNDED' ? (
                          <Button variant="ghost" size="sm" onClick={() => setTarget(payment)}>
                            환불
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {payments.data ? (
              <Pagination
                page={payments.data.page}
                totalPages={payments.data.totalPages}
                total={payments.data.total}
                onChange={setPage}
              />
            ) : null}
          </>
        )}
      </Card>

      {target ? <RefundForm payment={target} onClose={() => setTarget(null)} /> : null}
    </div>
  );
}

function RefundForm({ payment, onClose }: { payment: AdminPaymentRow; onClose: () => void }) {
  const refund = useRefund();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const refundable = payment.amount - payment.refundedAmount;
  const parsed = amount.trim() === '' ? undefined : Number(amount);
  const amountInvalid =
    parsed !== undefined && (!Number.isFinite(parsed) || parsed <= 0 || parsed > refundable);

  return (
    <Card className="mt-4 border-amber-500/30">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">환불 — {payment.tenant.channelName}</h2>
          <p className="mt-0.5 text-xs text-[var(--surface-muted)]">
            {payment.orderName} · 환불 가능 {refundable.toLocaleString('ko-KR')}원
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          닫기
        </Button>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field
          label="환불 금액"
          hint="비우면 전액 환불합니다."
          error={
            amountInvalid
              ? `1 ~ ${refundable.toLocaleString('ko-KR')}원 사이여야 합니다.`
              : undefined
          }
        >
          <Input
            type="number"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={String(refundable)}
            min={1}
            max={refundable}
          />
        </Field>

        <Field label="사유 (필수)">
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="예: 중복 결제 (티켓 #1234)"
            rows={2}
          />
        </Field>
      </div>

      <Button
        variant="danger"
        size="sm"
        className="mt-4"
        disabled={reason.trim().length === 0 || amountInvalid}
        loading={refund.isPending}
        onClick={() => {
          refund.mutate({
            paymentId: payment.paymentId,
            ...(parsed !== undefined ? { amount: parsed } : {}),
            reason,
          });
          onClose();
        }}
      >
        <Undo2 className="size-4" />
        환불 실행
      </Button>
    </Card>
  );
}
