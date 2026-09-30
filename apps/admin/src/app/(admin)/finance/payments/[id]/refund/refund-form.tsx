'use client';

import { formatMoney, minorToInput } from '@ustago/validation';
import { colors, spacing } from '@ustago/ui';
import Link from 'next/link';
import { useActionState, useState } from 'react';

import { parseAmountInput } from '@/lib/finance';
import { ADMIN_REFUND_REASONS, REFUND_REASON_LABELS } from '@/lib/labels';

import { type FinanceActionState, refundPayment } from '../../../actions';

interface Props {
  paymentId: string;
  refundableMinor: number;
  /** Made once per page render: a double submit reuses it and refunds once. */
  idempotencyKey: string;
}

type Reason = (typeof ADMIN_REFUND_REASONS)[number];

/**
 * Two steps: fill in and "İadeyi gözden geçir", then a confirm step that
 * restates the amount. Only the second step submits.
 */
export function RefundForm({ paymentId, refundableMinor, idempotencyKey }: Props) {
  const [state, action, pending] = useActionState<FinanceActionState, FormData>(refundPayment, {});
  const [step, setStep] = useState<'edit' | 'confirm'>('edit');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<Reason | ''>('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const amountMinor = parseAmountInput(amount);

  if (state.ok) {
    return (
      <div role="status" style={{ display: 'grid', gap: spacing.sm }}>
        <p style={{ color: colors.success }}>İade oluşturuldu.</p>
        <Link href={`/finance/payments/${paymentId}`} className="btn btn-primary">
          Ödeme detayına dön
        </Link>
      </div>
    );
  }

  function review() {
    if (amountMinor === null) {
      setProblem('Geçerli bir tutar girin (ör. 250 veya 1.000,50).');
    } else if (amountMinor > refundableMinor) {
      setProblem(`En fazla ${formatMoney(refundableMinor)} iade edilebilir.`);
    } else if (!reason) {
      setProblem('İade nedenini seçin.');
    } else if (note.trim().length < 3) {
      setProblem('İç not zorunludur (en az 3 karakter).');
    } else {
      setProblem(null);
      setStep('confirm');
    }
  }

  return (
    <form
      action={action}
      aria-label="İade"
      style={{ display: 'grid', gap: spacing.sm }}
      onSubmit={(e) => {
        // Enter in the amount field must not skip the confirm step.
        if (step !== 'confirm') {
          e.preventDefault();
          review();
        }
      }}
    >
      <input type="hidden" name="id" value={paymentId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="expectedRefundableMinor" value={String(refundableMinor)} />
      <p>
        İade edilebilir tutar: <strong>{formatMoney(refundableMinor)}</strong>
      </p>

      {step === 'edit' ? (
        <>
          <label style={{ display: 'grid', gap: spacing.xs }}>
            İade tutarı (TL)
            <span style={{ display: 'flex', gap: spacing.sm }}>
              <input
                name="amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="ör. 1.000,50"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                style={{ flex: 1, minHeight: 40, padding: 8 }}
              />
              <button
                type="button"
                className="btn"
                onClick={() => setAmount(minorToInput(refundableMinor))}
              >
                Tam iade
              </button>
            </span>
          </label>
          <label style={{ display: 'grid', gap: spacing.xs }}>
            İade nedeni
            <select
              name="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as Reason | '')}
              style={{ minHeight: 40 }}
            >
              <option value="" disabled>
                Seçin
              </option>
              {ADMIN_REFUND_REASONS.map((r) => (
                <option key={r} value={r}>
                  {REFUND_REASON_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: spacing.xs }}>
            İç not (yalnızca yöneticiler görür)
            <textarea
              name="note"
              required
              minLength={3}
              maxLength={1000}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button type="button" className="btn btn-primary" onClick={review}>
            İadeyi gözden geçir
          </button>
        </>
      ) : (
        <>
          <input type="hidden" name="amount" value={amount} />
          <input type="hidden" name="reason" value={reason} />
          <input type="hidden" name="note" value={note} />
          <div
            className="card"
            style={{ borderColor: colors.emergency, display: 'grid', gap: spacing.xs }}
          >
            <p>
              Müşteriye <strong>{amountMinor === null ? '—' : formatMoney(amountMinor)}</strong>{' '}
              iade edilecek
              {amountMinor === refundableMinor ? ' (tam iade)' : ' (kısmi iade)'}.
            </p>
            <p>Neden: {reason ? REFUND_REASON_LABELS[reason] : '—'}</p>
            <p style={{ whiteSpace: 'pre-wrap' }}>İç not: {note}</p>
            <p style={{ color: colors.emergency, fontWeight: 700 }}>Bu işlem geri alınamaz.</p>
          </div>
          <div style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn"
              disabled={pending}
              onClick={() => setStep('edit')}
            >
              Geri dön
            </button>
            <button type="submit" className="btn btn-danger" disabled={pending}>
              {pending ? 'İade ediliyor…' : 'İadeyi onayla'}
            </button>
          </div>
        </>
      )}

      {problem ? (
        <p role="alert" style={{ color: colors.emergency, fontSize: 14 }}>
          {problem}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" style={{ color: colors.emergency, fontSize: 14 }}>
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
