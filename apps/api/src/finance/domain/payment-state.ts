import type {
  JobStatus,
  PaymentStatus,
  PaymentTransactionStatus,
} from '../../generated/prisma/enums.js';

/**
 * Payment and attempt state rules (docs/adr/0019). Only the payment
 * provider (a verified webhook or a server-to-server call) moves money
 * states; a client saying "ödeme başarılı" changes nothing.
 */

/** Payments that are still waiting for money. */
export const IN_FLIGHT_PAYMENT_STATUSES: readonly PaymentStatus[] = ['PENDING', 'AUTHORIZED'];
/** Payments whose money was captured (refunds do not undo the capture). */
export const CAPTURED_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'SUCCEEDED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
];
/** Job states in which the customer may pay online. */
export const PAYABLE_JOB_STATUSES: readonly JobStatus[] = [
  'CREATED',
  'CONFIRMED',
  'PROVIDER_PREPARING',
  'PROVIDER_EN_ROUTE',
  'PROVIDER_ARRIVED',
  'IN_PROGRESS',
  'AWAITING_COMPLETION_CONFIRMATION',
  'COMPLETED',
];

export function isCaptured(status: PaymentStatus): boolean {
  return CAPTURED_PAYMENT_STATUSES.includes(status);
}

export function isInFlight(status: PaymentStatus): boolean {
  return IN_FLIGHT_PAYMENT_STATUSES.includes(status);
}

/**
 * What the customer still has to pay: job total − captured − in flight.
 * Never negative (a change order can only add, so it cannot turn an
 * overpayment into a negative number, but the floor keeps it honest).
 */
export function outstandingAmount(input: {
  jobTotal: bigint;
  captured: bigint;
  inFlight: bigint;
}): bigint {
  const rest = input.jobTotal - input.captured - input.inFlight;
  return rest > 0n ? rest : 0n;
}

/** Provider-reported attempt outcome, as carried by a webhook. */
export type ProviderAttemptState = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

const RANK: Record<PaymentTransactionStatus, number> = {
  PENDING: 0,
  FAILED: 1,
  CANCELLED: 1,
  // Money arrived: always wins (see below).
  SUCCEEDED: 2,
};

export type AttemptDecision =
  | { kind: 'APPLY'; to: ProviderAttemptState }
  /** Same state again (retry / replay under a new event id). */
  | { kind: 'NOOP' }
  /** Older than what we know (out of order): never move back. */
  | { kind: 'STALE' };

/**
 * Attempt transitions are forward-only: PENDING → SUCCEEDED | FAILED |
 * CANCELLED. A late "pending" or "failed" after "succeeded" is stale.
 * The one move out of a terminal state is FAILED | CANCELLED → SUCCEEDED:
 * the provider says the money did arrive (e.g. we withdrew the attempt
 * because the job was cancelled, but the card was already charged). That
 * money is captured and, when nothing is due, refunded automatically;
 * ignoring it would leave the customer charged with no record.
 */
export function decideAttemptTransition(
  current: PaymentTransactionStatus,
  reported: ProviderAttemptState,
): AttemptDecision {
  if (current === reported) return { kind: 'NOOP' };
  if (RANK[reported] <= RANK[current]) return { kind: 'STALE' };
  return { kind: 'APPLY', to: reported };
}

/** Payment status after its refunds (captured payments only). */
export function statusAfterRefunds(amount: bigint, refundedSucceeded: bigint): PaymentStatus {
  if (refundedSucceeded <= 0n) return 'SUCCEEDED';
  if (refundedSucceeded >= amount) return 'REFUNDED';
  return 'PARTIALLY_REFUNDED';
}

/** User-facing Turkish message for a failure code (technical detail stays in logs). */
export function paymentFailureMessage(code: string | null): string {
  switch (code) {
    case 'CARD_DECLINED':
      return 'Kart reddedildi. Lütfen başka bir kartla tekrar deneyin.';
    case 'TIMEOUT':
    case 'PROVIDER_ERROR':
    default:
      return 'Ödeme alınamadı. Lütfen tekrar deneyin.';
  }
}
