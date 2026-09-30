import { canDisputeCash, decideCashConfirm, hasConfirmed } from './cash.js';
import {
  canRelease,
  debtToSettle,
  holdUntil,
  initialEarningStatus,
  withdrawable,
} from './earning.js';
import {
  decideAttemptTransition,
  outstandingAmount,
  paymentFailureMessage,
  statusAfterRefunds,
} from './payment-state.js';
import { checkPayoutAmount, payoutTransition } from './payout.js';

describe('payment attempt states', () => {
  it('moves forward only; success after a local cancel is still money', () => {
    expect(decideAttemptTransition('PENDING', 'SUCCEEDED')).toEqual({
      kind: 'APPLY',
      to: 'SUCCEEDED',
    });
    expect(decideAttemptTransition('SUCCEEDED', 'SUCCEEDED')).toEqual({ kind: 'NOOP' });
    expect(decideAttemptTransition('SUCCEEDED', 'FAILED')).toEqual({ kind: 'STALE' });
    expect(decideAttemptTransition('SUCCEEDED', 'PENDING')).toEqual({ kind: 'STALE' });
    expect(decideAttemptTransition('FAILED', 'CANCELLED')).toEqual({ kind: 'STALE' });
    expect(decideAttemptTransition('CANCELLED', 'SUCCEEDED')).toEqual({
      kind: 'APPLY',
      to: 'SUCCEEDED',
    });
  });

  it('outstanding = total − captured − in flight, never negative', () => {
    expect(outstandingAmount({ jobTotal: 270000n, captured: 220000n, inFlight: 0n })).toBe(50000n);
    expect(outstandingAmount({ jobTotal: 220000n, captured: 270000n, inFlight: 0n })).toBe(0n);
  });

  it('status after refunds', () => {
    expect(statusAfterRefunds(100n, 0n)).toBe('SUCCEEDED');
    expect(statusAfterRefunds(100n, 1n)).toBe('PARTIALLY_REFUNDED');
    expect(statusAfterRefunds(100n, 100n)).toBe('REFUNDED');
  });

  it('shows one friendly failure message', () => {
    expect(paymentFailureMessage('TIMEOUT')).toBe('Ödeme alınamadı. Lütfen tekrar deneyin.');
    expect(paymentFailureMessage(null)).toBe('Ödeme alınamadı. Lütfen tekrar deneyin.');
  });
});

describe('cash settlement', () => {
  it('needs both sides; one button never settles', () => {
    expect(decideCashConfirm('AWAITING_CONFIRMATION', 'CUSTOMER')).toEqual({
      kind: 'MOVE',
      to: 'CUSTOMER_CONFIRMED',
      confirmed: false,
    });
    expect(decideCashConfirm('CUSTOMER_CONFIRMED', 'CUSTOMER')).toEqual({ kind: 'ALREADY_DONE' });
    expect(decideCashConfirm('CUSTOMER_CONFIRMED', 'PROVIDER')).toEqual({
      kind: 'MOVE',
      to: 'CONFIRMED',
      confirmed: true,
    });
    expect(decideCashConfirm('DISPUTED', 'PROVIDER')).toEqual({ kind: 'INVALID' });
    expect(canDisputeCash('CONFIRMED')).toBe(false);
    expect(canDisputeCash('PROVIDER_CONFIRMED')).toBe(true);
    expect(hasConfirmed('PROVIDER_CONFIRMED', 'CUSTOMER')).toBe(false);
  });
});

describe('earnings', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  it('releases only completed jobs after the hold', () => {
    const until = holdUntil(now, new Date('2026-10-01T10:00:00Z'), 72);
    expect(until.toISOString()).toBe('2026-10-04T12:00:00.000Z');
    expect(canRelease({ status: 'PENDING', jobStatus: 'COMPLETED', holdUntil: until, now })).toBe(
      false,
    );
    expect(canRelease({ status: 'PENDING', jobStatus: 'COMPLETED', holdUntil: now, now })).toBe(
      true,
    );
    expect(canRelease({ status: 'HELD', jobStatus: 'COMPLETED', holdUntil: now, now })).toBe(false);
    expect(canRelease({ status: 'PENDING', jobStatus: 'DISPUTED', holdUntil: now, now })).toBe(
      false,
    );
    expect(initialEarningStatus('DISPUTED')).toBe('HELD');
  });

  it('offsets debt and never lets withdrawable go negative', () => {
    expect(debtToSettle({ releaseAmount: 100n, platformDebt: 30n, offsetEnabled: true })).toBe(30n);
    expect(debtToSettle({ releaseAmount: 100n, platformDebt: 300n, offsetEnabled: true })).toBe(
      100n,
    );
    expect(debtToSettle({ releaseAmount: 100n, platformDebt: 30n, offsetEnabled: false })).toBe(0n);
    expect(withdrawable(229500n, 33000n)).toBe(196500n);
    expect(withdrawable(100n, 300n)).toBe(0n);
  });
});

describe('payouts', () => {
  it('follows REQUESTED → APPROVED → PROCESSING → PAID | FAILED', () => {
    expect(payoutTransition('REQUESTED', 'APPROVE')).toBe('APPROVED');
    expect(payoutTransition('APPROVED', 'START_PROCESSING')).toBe('PROCESSING');
    expect(payoutTransition('PROCESSING', 'MARK_PAID')).toBe('PAID');
    expect(payoutTransition('PROCESSING', 'MARK_FAILED')).toBe('FAILED');
    expect(payoutTransition('PAID', 'CANCEL')).toBeNull();
    expect(payoutTransition('PROCESSING', 'CANCEL')).toBeNull();
    expect(payoutTransition('REQUESTED', 'MARK_PAID')).toBeNull();
  });

  it('Faz 6: an unknown provider outcome parks the payout, only a decision ends it', () => {
    expect(payoutTransition('APPROVED', 'MARK_UNKNOWN')).toBe('NEEDS_RECONCILIATION');
    expect(payoutTransition('PROCESSING', 'MARK_UNKNOWN')).toBe('NEEDS_RECONCILIATION');
    expect(payoutTransition('NEEDS_RECONCILIATION', 'MARK_PAID')).toBe('PAID');
    expect(payoutTransition('NEEDS_RECONCILIATION', 'MARK_FAILED')).toBe('FAILED');
    // Never cancelled or retried blindly: the bank may have sent the money.
    expect(payoutTransition('NEEDS_RECONCILIATION', 'CANCEL')).toBeNull();
    expect(payoutTransition('NEEDS_RECONCILIATION', 'START_PROCESSING')).toBeNull();
    expect(payoutTransition('REQUESTED', 'MARK_UNKNOWN')).toBeNull();
  });

  it('checks minimum and withdrawable', () => {
    expect(checkPayoutAmount({ amount: 5000n, withdrawable: 229500n, minimum: 10000n })).toEqual({
      ok: false,
      code: 'PAYOUT_BELOW_MINIMUM',
    });
    expect(checkPayoutAmount({ amount: 200000n, withdrawable: 29500n, minimum: 10000n })).toEqual({
      ok: false,
      code: 'INSUFFICIENT_AVAILABLE_BALANCE',
    });
    expect(checkPayoutAmount({ amount: 200000n, withdrawable: 229500n, minimum: 10000n })).toEqual({
      ok: true,
    });
  });
});
