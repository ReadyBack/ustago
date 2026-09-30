import type {
  LedgerAccountType,
  LedgerDirection,
  LedgerTransactionType,
} from '../../generated/prisma/enums.js';

/**
 * Double-entry rules (docs/adr/0018). These are the application's own
 * ledger accounts, not a statutory chart of accounts: they record what
 * UstaGO owes whom and why money moved.
 *
 * Every transaction has at least two lines, amounts are positive integers
 * and the direction carries the sign; total DEBIT must equal total CREDIT
 * (also enforced by a deferred database trigger).
 */

/** Which side increases an account's balance. */
export const NORMAL_SIDE: Record<LedgerAccountType, LedgerDirection> = {
  // Assets of the platform: money held at the payment institution, and
  // what providers owe the platform.
  PLATFORM_CLEARING: 'DEBIT',
  PROVIDER_PLATFORM_DEBT: 'DEBIT',
  // Liabilities / income: what the platform owes providers and customers,
  // and fee revenue.
  PROVIDER_PENDING: 'CREDIT',
  PROVIDER_AVAILABLE: 'CREDIT',
  PROVIDER_RESERVED: 'CREDIT',
  REFUND_LIABILITY: 'CREDIT',
  PLATFORM_FEE_REVENUE: 'CREDIT',
};

export const PROVIDER_ACCOUNT_TYPES: readonly LedgerAccountType[] = [
  'PROVIDER_PENDING',
  'PROVIDER_AVAILABLE',
  'PROVIDER_RESERVED',
  'PROVIDER_PLATFORM_DEBT',
];

export function isProviderAccount(type: LedgerAccountType): boolean {
  return PROVIDER_ACCOUNT_TYPES.includes(type);
}

export interface AccountRef {
  type: LedgerAccountType;
  /** Required for provider accounts, absent for platform accounts. */
  providerId?: string;
}

export interface LedgerLine {
  account: AccountRef;
  direction: LedgerDirection;
  amount: bigint;
}

export class LedgerError extends Error {}

export const debit = (account: AccountRef, amount: bigint): LedgerLine => ({
  account,
  direction: 'DEBIT',
  amount,
});
export const credit = (account: AccountRef, amount: bigint): LedgerLine => ({
  account,
  direction: 'CREDIT',
  amount,
});

/**
 * Drops zero lines (a builder may produce "₺0 debt settled") and checks the
 * rest: ≥ 2 lines, positive amounts, provider accounts carry a provider,
 * platform accounts do not, and debit = credit.
 */
export function validateLines(lines: readonly LedgerLine[]): LedgerLine[] {
  const kept = lines.filter((l) => l.amount !== 0n);
  if (kept.length < 2) throw new LedgerError('a ledger transaction needs at least two lines');
  let debits = 0n;
  let credits = 0n;
  for (const line of kept) {
    if (line.amount < 0n) throw new LedgerError('ledger amounts are positive; use the direction');
    if (isProviderAccount(line.account.type) !== Boolean(line.account.providerId)) {
      throw new LedgerError(`account ${line.account.type} has the wrong owner`);
    }
    if (line.direction === 'DEBIT') debits += line.amount;
    else credits += line.amount;
  }
  if (debits !== credits) {
    throw new LedgerError(`unbalanced ledger transaction: debit ${debits} ≠ credit ${credits}`);
  }
  return kept;
}

/** The mirror image of a transaction (every direction swapped). */
export function reversalLines(lines: readonly LedgerLine[]): LedgerLine[] {
  return lines.map((l) => ({
    ...l,
    direction: l.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT',
  }));
}

/** Balance of one account from its entries, in its normal direction. */
export function balanceOf(
  type: LedgerAccountType,
  entries: readonly { direction: LedgerDirection; amount: bigint }[],
): bigint {
  const normal = NORMAL_SIDE[type];
  return entries.reduce(
    (sum, e) => (e.direction === normal ? sum + e.amount : sum - e.amount),
    0n,
  );
}

/** Signed effect of one entry on its account's balance. */
export function signedEffect(
  type: LedgerAccountType,
  direction: LedgerDirection,
  amount: bigint,
): bigint {
  return direction === NORMAL_SIDE[type] ? amount : -amount;
}

/** Debit total, credit total and whether they match (global invariant). */
export function trialBalance(
  entries: readonly { direction: LedgerDirection; amount: bigint }[],
): { debit: bigint; credit: bigint; balanced: boolean } {
  let d = 0n;
  let c = 0n;
  for (const e of entries) {
    if (e.direction === 'DEBIT') d += e.amount;
    else c += e.amount;
  }
  return { debit: d, credit: c, balanced: d === c };
}

// ---------------------------------------------------------------------------
// Transaction builders: one per financial event. Pure, unit-tested.
// ---------------------------------------------------------------------------

const platform = (type: LedgerAccountType): AccountRef => ({ type });
const provider = (type: LedgerAccountType, providerId: string): AccountRef => ({
  type,
  providerId,
});

export interface BuiltTransaction {
  type: LedgerTransactionType;
  lines: LedgerLine[];
}

/**
 * Online payment succeeded: the money is at the payment institution
 * (clearing); the fee is platform revenue, the rest is owed to the
 * provider but not yet releasable.
 */
export function paymentCaptured(input: {
  providerId: string;
  gross: bigint;
  fee: bigint;
}): BuiltTransaction {
  return {
    type: 'PAYMENT_CAPTURED',
    lines: validateLines([
      debit(platform('PLATFORM_CLEARING'), input.gross),
      credit(platform('PLATFORM_FEE_REVENUE'), input.fee),
      credit(provider('PROVIDER_PENDING', input.providerId), input.gross - input.fee),
    ]),
  };
}

/**
 * Pending earning becomes available. With debt offset on, what the
 * provider owes the platform is settled first:
 * pending ₺2.295, debt ₺405 → ₺405 debt settled + ₺1.890 available.
 */
export function earningReleased(input: {
  providerId: string;
  amount: bigint;
  debtToSettle: bigint;
}): BuiltTransaction {
  if (input.debtToSettle < 0n || input.debtToSettle > input.amount) {
    throw new LedgerError('debt to settle must be between 0 and the released amount');
  }
  return {
    type: 'EARNING_RELEASED',
    lines: validateLines([
      debit(provider('PROVIDER_PENDING', input.providerId), input.amount),
      credit(provider('PROVIDER_PLATFORM_DEBT', input.providerId), input.debtToSettle),
      credit(provider('PROVIDER_AVAILABLE', input.providerId), input.amount - input.debtToSettle),
    ]),
  };
}

/**
 * Cash job confirmed by both sides: UstaGO never saw the money, so no
 * clearing line. The platform fee becomes the provider's debt.
 */
export function cashFeeAssessed(input: { providerId: string; fee: bigint }): BuiltTransaction {
  return {
    type: 'CASH_FEE_ASSESSED',
    lines: validateLines([
      debit(provider('PROVIDER_PLATFORM_DEBT', input.providerId), input.fee),
      credit(platform('PLATFORM_FEE_REVENUE'), input.fee),
    ]),
  };
}

/** Where the provider's part of a refund is taken from. */
export interface RefundProviderSource {
  fromPending: bigint;
  fromAvailable: bigint;
  /** Already paid out / reserved: the provider now owes it back. */
  toDebt: bigint;
}

/**
 * Refund accepted: fee revenue and the provider's earning are reduced, the
 * refund is owed to the customer until the payment provider confirms it.
 */
export function refundRequested(input: {
  providerId: string;
  amount: bigint;
  feePortion: bigint;
  source: RefundProviderSource;
}): BuiltTransaction {
  const { source } = input;
  if (input.feePortion + source.fromPending + source.fromAvailable + source.toDebt !== input.amount) {
    throw new LedgerError('refund portions do not add up to the refund amount');
  }
  return {
    type: 'REFUND_REQUESTED',
    lines: validateLines([
      debit(platform('PLATFORM_FEE_REVENUE'), input.feePortion),
      debit(provider('PROVIDER_PENDING', input.providerId), source.fromPending),
      debit(provider('PROVIDER_AVAILABLE', input.providerId), source.fromAvailable),
      debit(provider('PROVIDER_PLATFORM_DEBT', input.providerId), source.toDebt),
      credit(platform('REFUND_LIABILITY'), input.amount),
    ]),
  };
}

/** The payment provider returned the money to the customer. */
export function refundCompleted(amount: bigint): BuiltTransaction {
  return {
    type: 'REFUND_COMPLETED',
    lines: validateLines([
      debit(platform('REFUND_LIABILITY'), amount),
      credit(platform('PLATFORM_CLEARING'), amount),
    ]),
  };
}

/** Payout requested: available → reserved (cannot be requested twice). */
export function payoutReserved(input: { providerId: string; amount: bigint }): BuiltTransaction {
  return {
    type: 'PAYOUT_RESERVED',
    lines: validateLines([
      debit(provider('PROVIDER_AVAILABLE', input.providerId), input.amount),
      credit(provider('PROVIDER_RESERVED', input.providerId), input.amount),
    ]),
  };
}

/** Payout sent to the provider's bank: the money leaves clearing. */
export function payoutPaid(input: { providerId: string; amount: bigint }): BuiltTransaction {
  return {
    type: 'PAYOUT_PAID',
    lines: validateLines([
      debit(provider('PROVIDER_RESERVED', input.providerId), input.amount),
      credit(platform('PLATFORM_CLEARING'), input.amount),
    ]),
  };
}

/** Payout failed or was cancelled: reserved money is available again. */
export function payoutReleased(input: { providerId: string; amount: bigint }): BuiltTransaction {
  return {
    type: 'PAYOUT_RELEASED',
    lines: validateLines([
      debit(provider('PROVIDER_RESERVED', input.providerId), input.amount),
      credit(provider('PROVIDER_AVAILABLE', input.providerId), input.amount),
    ]),
  };
}
