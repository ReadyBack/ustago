import type { PayoutStatus } from '../../generated/prisma/enums.js';

/**
 * Payout state machine (docs/adr/0020). REQUESTED → APPROVED → PROCESSING →
 * PAID | FAILED; REQUESTED/APPROVED → CANCELLED. The money is reserved at
 * request time and released again on FAILED / CANCELLED.
 */

export type PayoutEvent = 'APPROVE' | 'START_PROCESSING' | 'MARK_PAID' | 'MARK_FAILED' | 'CANCEL';

const TRANSITIONS: Record<PayoutEvent, { from: readonly PayoutStatus[]; to: PayoutStatus }> = {
  APPROVE: { from: ['REQUESTED'], to: 'APPROVED' },
  START_PROCESSING: { from: ['APPROVED'], to: 'PROCESSING' },
  MARK_PAID: { from: ['PROCESSING'], to: 'PAID' },
  MARK_FAILED: { from: ['APPROVED', 'PROCESSING'], to: 'FAILED' },
  CANCEL: { from: ['REQUESTED', 'APPROVED'], to: 'CANCELLED' },
};

export function payoutTransition(current: PayoutStatus, event: PayoutEvent): PayoutStatus | null {
  const t = TRANSITIONS[event];
  return t.from.includes(current) ? t.to : null;
}

export function sourceStatuses(event: PayoutEvent): readonly PayoutStatus[] {
  return TRANSITIONS[event].from;
}

/** Statuses whose money is still reserved. */
export const RESERVED_PAYOUT_STATUSES: readonly PayoutStatus[] = [
  'REQUESTED',
  'APPROVED',
  'PROCESSING',
];

export type PayoutCheck =
  | { ok: true }
  | { ok: false; code: 'PAYOUT_BELOW_MINIMUM' | 'INSUFFICIENT_AVAILABLE_BALANCE' };

export function checkPayoutAmount(input: {
  amount: bigint;
  withdrawable: bigint;
  minimum: bigint;
}): PayoutCheck {
  if (input.amount < input.minimum) return { ok: false, code: 'PAYOUT_BELOW_MINIMUM' };
  if (input.amount > input.withdrawable) {
    return { ok: false, code: 'INSUFFICIENT_AVAILABLE_BALANCE' };
  }
  return { ok: true };
}
