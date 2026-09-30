import { MoneyError, mulDivHalfUp } from './fee.js';
import type { RefundProviderSource } from './ledger.js';

/**
 * Refund arithmetic (docs/adr/0020). The refundable amount is always the
 * captured amount minus refunds that did not fail; the caller holds the
 * payment row lock while it computes and inserts.
 */

export function refundableAmount(paid: bigint, nonFailedRefunds: bigint): bigint {
  const rest = paid - nonFailedRefunds;
  return rest > 0n ? rest : 0n;
}

export class RefundAmountError extends Error {}

export function assertRefundable(amount: bigint, refundable: bigint): void {
  if (amount <= 0n) throw new RefundAmountError('refund amount must be positive');
  if (amount > refundable) throw new RefundAmountError('refund exceeds the refundable amount');
}

/**
 * Splits a refund between the platform fee and the provider, in proportion
 * to the payment's own split. Computed cumulatively so that refunding a
 * payment in several parts gives back exactly its fee in total:
 * feePortion = round(fee × refundedAfter / paid) − round(fee × refundedBefore / paid).
 */
export function splitRefund(input: {
  paid: bigint;
  fee: bigint;
  refundedBefore: bigint;
  amount: bigint;
}): { feePortion: bigint; providerPortion: bigint } {
  const { paid, fee, refundedBefore, amount } = input;
  if (paid <= 0n || fee < 0n || fee > paid) throw new MoneyError('invalid payment split');
  if (refundedBefore < 0n || amount <= 0n || refundedBefore + amount > paid) {
    throw new RefundAmountError('refund exceeds the payment');
  }
  const feeAfter = mulDivHalfUp(fee, refundedBefore + amount, paid);
  const feeBefore = mulDivHalfUp(fee, refundedBefore, paid);
  const feePortion = feeAfter - feeBefore;
  return { feePortion, providerPortion: amount - feePortion };
}

/**
 * Where the provider's part of a refund comes from, depending on how far
 * the earning got:
 *  - still pending (or held): from pending;
 *  - released: from available, as far as it goes; whatever the provider
 *    has already withdrawn or reserved becomes platform debt (refund after
 *    payout, docs/adr/0020). No bank money is pulled back.
 */
export function refundSource(input: {
  providerPortion: bigint;
  earningReleased: boolean;
  earningPendingBalance: bigint;
  providerAvailable: bigint;
}): RefundProviderSource {
  const { providerPortion } = input;
  if (providerPortion < 0n) throw new MoneyError('provider portion must not be negative');
  if (!input.earningReleased) {
    if (input.earningPendingBalance < providerPortion) {
      throw new MoneyError('pending earning is smaller than the refund portion');
    }
    return { fromPending: providerPortion, fromAvailable: 0n, toDebt: 0n };
  }
  const available = input.providerAvailable > 0n ? input.providerAvailable : 0n;
  const fromAvailable = providerPortion < available ? providerPortion : available;
  return { fromPending: 0n, fromAvailable, toDebt: providerPortion - fromAvailable };
}
