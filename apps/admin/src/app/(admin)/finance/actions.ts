'use server';

import {
  adminCashResolveSchema,
  adminPayoutDecisionSchema,
  adminRefundSchema,
  idempotencyKeySchema,
  resolvePayoutRequestSchema,
  uuidSchema,
  verifyPayoutDestinationRequestSchema,
} from '@ustago/validation';
import { revalidatePath } from 'next/cache';

import { FORBIDDEN_MESSAGE } from '@/lib/action-errors';
import { apiAction } from '@/lib/api';
import { parseAmountInput, REFUND_STALE_MESSAGE } from '@/lib/finance';

export interface FinanceActionState {
  ok?: boolean;
  error?: string;
}

const MESSAGES: Record<string, string> = {
  REFUND_STALE: REFUND_STALE_MESSAGE,
  REFUND_EXCEEDS_REFUNDABLE: 'İade tutarı iade edilebilir tutarı aşıyor.',
  REFUND_NOT_ALLOWED: 'Bu ödeme şu anki durumunda iade edilemez.',
  IDEMPOTENCY_KEY_REUSED: 'Bu istek anahtarı başka bir işlemde kullanıldı; sayfayı yenileyin.',
  IDEMPOTENCY_KEY_REQUIRED: 'İstek anahtarı eksik; sayfayı yenileyin.',
  PAYMENT_NOT_FOUND: 'Ödeme bulunamadı.',
  PAYOUT_NOT_FOUND: 'Para çekme talebi bulunamadı.',
  PAYOUT_INVALID_STATE: 'Talebin durumu değişmiş; sayfayı yenileyin.',
  PAYOUTS_DISABLED: 'Para çekme şu anda kullanılamıyor.',
  CASH_SETTLEMENT_NOT_FOUND: 'Nakit ödeme kaydı bulunamadı.',
  CASH_INVALID_STATE: 'Nakit ödeme kaydının durumu değişmiş; sayfayı yenileyin.',
  ROUTE_NOT_FOUND: 'Bu test işlemi yalnızca test ödeme sağlayıcısıyla kullanılabilir.',
  PAYOUT_DESTINATION_NOT_FOUND: 'Banka hesabı bulunamadı.',
};

const INVALID = { error: 'Geçersiz istek.' };
const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
};

function firstIssue(error: { issues: readonly { message: string }[] }): string {
  return error.issues[0]?.message ?? 'Geçersiz istek.';
}

async function send(
  path: string,
  body: unknown,
  revalidate: string[],
  headers?: Record<string, string>,
): Promise<FinanceActionState> {
  const result = await apiAction(path, { method: 'POST', body, headers });
  if (!result.ok) {
    return {
      error: MESSAGES[result.code] ?? (result.status === 403 ? FORBIDDEN_MESSAGE : result.message),
    };
  }
  for (const p of revalidate) revalidatePath(p);
  return { ok: true };
}

/**
 * Full or partial refund. The Idempotency-Key comes from the form (made
 * once per page render), so a double submit never refunds twice; the
 * refundable amount the admin confirmed travels along and the API refuses
 * the refund if it changed.
 */
export async function refundPayment(
  _prev: FinanceActionState,
  form: FormData,
): Promise<FinanceActionState> {
  const id = uuidSchema.safeParse(form.get('id'));
  const key = idempotencyKeySchema.safeParse(form.get('idempotencyKey'));
  const expected = text(form, 'expectedRefundableMinor');
  if (!id.success || !key.success || !/^\d+$/.test(expected)) return INVALID;
  const amountMinor = parseAmountInput(text(form, 'amount'));
  if (amountMinor === null) return { error: 'Geçerli bir tutar girin (ör. 250 veya 1.000,50).' };
  const body = adminRefundSchema.safeParse({
    amountMinor,
    reason: text(form, 'reason'),
    note: text(form, 'note'),
    expectedRefundableMinor: Number(expected),
  });
  if (!body.success) return { error: firstIssue(body.error) };
  if (body.data.amountMinor > body.data.expectedRefundableMinor) {
    return { error: 'İade tutarı iade edilebilir tutarı aşıyor.' };
  }
  return send(
    `/admin/finance/payments/${id.data}/refunds`,
    body.data,
    ['/finance', '/finance/payments', `/finance/payments/${id.data}`],
    { 'Idempotency-Key': key.data },
  );
}

const PAYOUT_PATHS: Record<string, (id: string) => string> = {
  approve: (id) => `/admin/finance/payouts/${id}/approve`,
  cancel: (id) => `/admin/finance/payouts/${id}/cancel`,
  'mark-paid': (id) => `/admin/dev/payouts/${id}/mark-paid`,
  'mark-failed': (id) => `/admin/dev/payouts/${id}/mark-failed`,
};

/** Approve / cancel a payout; the two TEST decisions exist only with the mock provider. */
export async function decidePayout(
  _prev: FinanceActionState,
  form: FormData,
): Promise<FinanceActionState> {
  const id = uuidSchema.safeParse(form.get('id'));
  const decision = text(form, 'decision');
  const path = PAYOUT_PATHS[decision];
  if (!id.success || !path) return INVALID;
  let body: unknown;
  if (decision === 'cancel') {
    const note = text(form, 'note').trim();
    const parsed = adminPayoutDecisionSchema.safeParse(note ? { note } : {});
    if (!parsed.success) return { error: firstIssue(parsed.error) };
    body = parsed.data;
  }
  return send(path(id.data), body, ['/finance', '/finance/payouts']);
}

/** Settle a disputed cash payment: paid after all, or recorded as unpaid. */
export async function resolveCash(
  _prev: FinanceActionState,
  form: FormData,
): Promise<FinanceActionState> {
  const id = uuidSchema.safeParse(form.get('id'));
  if (!id.success) return INVALID;
  const body = adminCashResolveSchema.safeParse({
    outcome: text(form, 'outcome'),
    note: text(form, 'note'),
  });
  if (!body.success) return { error: firstIssue(body.error) };
  return send(`/admin/finance/cash-settlements/${id.data}/resolve`, body.data, [
    '/finance',
    '/finance/cash',
  ]);
}

/**
 * Close a payout whose outcome was unknown (NEEDS_RECONCILIATION) after
 * checking with the payout provider: PAID or FAILED, with a note.
 */
export async function resolvePayout(
  _prev: FinanceActionState,
  form: FormData,
): Promise<FinanceActionState> {
  const id = uuidSchema.safeParse(form.get('id'));
  if (!id.success) return INVALID;
  const body = resolvePayoutRequestSchema.safeParse({
    outcome: text(form, 'outcome'),
    note: text(form, 'note'),
  });
  if (!body.success) {
    return {
      error:
        body.error.issues[0]?.path[0] === 'note'
          ? 'Not 5–500 karakter olmalı.'
          : 'Sağlayıcıdaki sonucu seçin.',
    };
  }
  return send(`/admin/finance/payouts/${id.data}/resolve`, body.data, [
    '/finance',
    '/finance/payouts',
  ]);
}

/** Mark a (TEST) bank account as verified after checking it. */
export async function verifyPayoutDestination(
  _prev: FinanceActionState,
  form: FormData,
): Promise<FinanceActionState> {
  const id = uuidSchema.safeParse(form.get('id'));
  if (!id.success) return INVALID;
  const body = verifyPayoutDestinationRequestSchema.safeParse({ note: text(form, 'note') });
  if (!body.success) return { error: 'Not 5–500 karakter olmalı.' };
  return send(`/admin/finance/payout-destinations/${id.data}/verify`, body.data, [
    '/finance/payouts',
  ]);
}
