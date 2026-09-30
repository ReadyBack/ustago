import { MAX_PRICE_MINOR } from '@ustago/validation';

import type { ChangeOrderStatus, JobStatus } from '../../generated/prisma/client.js';

/**
 * Change orders (docs/adr/0015): extra work found during the job. The
 * provider proposes a positive amount, the customer accepts or rejects.
 * AGREED_PRICE never moves; only an accepted change order adds to the
 * job's current total, in the same transaction.
 */

/** A change order can only be proposed while the work is under way. */
export function canProposeChangeOrder(status: JobStatus): boolean {
  return status === 'IN_PROGRESS';
}

/** The customer can answer while the job is still under way. */
export function canAnswerChangeOrder(status: JobStatus): boolean {
  return status === 'IN_PROGRESS';
}

export type ChangeOrderAnswer = 'ACCEPT' | 'REJECT' | 'CANCEL';

const ANSWER_TO: Record<ChangeOrderAnswer, ChangeOrderStatus> = {
  ACCEPT: 'ACCEPTED',
  REJECT: 'REJECTED',
  CANCEL: 'CANCELLED',
};

/** Only a PENDING order can be answered; everything else is final. */
export function answerTransition(
  status: ChangeOrderStatus,
  answer: ChangeOrderAnswer,
): ChangeOrderStatus | null {
  return status === 'PENDING' ? ANSWER_TO[answer] : null;
}

export class ChangeOrderAmountError extends RangeError {}

/**
 * Total after the extra work. Amounts are integer kuruş (BigInt); zero or
 * negative extras and totals above the marketplace price ceiling are
 * refused.
 */
export function proposedTotal(currentTotalMinor: bigint, amountMinor: bigint): bigint {
  if (amountMinor <= 0n) throw new ChangeOrderAmountError('Change order amount must be positive');
  const total = currentTotalMinor + amountMinor;
  if (total > BigInt(MAX_PRICE_MINOR)) {
    throw new ChangeOrderAmountError('Job total would exceed the price ceiling');
  }
  return total;
}

/**
 * New job total when an order is accepted. The order was proposed against
 * the job's total at that time; since only one order is pending at a time
 * the totals must still match, and anything else is a stale order.
 */
export function totalAfterAccept(
  currentTotalMinor: bigint,
  order: { previousTotalMinor: bigint; amountDeltaMinor: bigint },
): bigint | null {
  if (order.previousTotalMinor !== currentTotalMinor) return null;
  return currentTotalMinor + order.amountDeltaMinor;
}
