import type { Payment, PaymentAttempt, Payout, PayoutDestination } from '@ustago/types';

import { toMoney } from '../common/money.js';
import type {
  CurrencyCode,
  Payment as PaymentRow,
  PaymentTransaction,
  Payout as PayoutRow,
  PayoutDestination as DestinationRow,
} from '../generated/prisma/client.js';

export function toAttempt(a: PaymentTransaction): PaymentAttempt {
  return {
    id: a.id,
    attemptNumber: a.attemptNumber,
    status: a.status,
    failureCode: a.failureCode,
    createdAt: a.createdAt.toISOString(),
    completedAt: a.completedAt?.toISOString() ?? null,
  };
}

export function toPayment(
  p: PaymentRow & { transactions: PaymentTransaction[] },
  refundedMinor: bigint,
  testMode: boolean,
): Payment {
  return {
    id: p.id,
    jobId: p.jobId,
    method: 'IN_APP',
    status: p.status,
    amount: toMoney(p.amountMinor, p.currency),
    refunded: toMoney(refundedMinor, p.currency),
    net: toMoney(p.amountMinor - refundedMinor, p.currency),
    testMode,
    lastFailureCode: p.lastFailureCode,
    createdAt: p.createdAt.toISOString(),
    succeededAt: p.succeededAt?.toISOString() ?? null,
    attempts: [...p.transactions]
      .sort((a, b) => a.attemptNumber - b.attemptNumber)
      .map(toAttempt),
  };
}

export function toDestination(d: DestinationRow): PayoutDestination {
  return { id: d.id, holderName: d.holderName, maskedIban: d.maskedIban, isTest: d.isTest };
}

export function toPayout(p: PayoutRow & { destination: DestinationRow }): Payout {
  return {
    id: p.id,
    amount: toMoney(p.amountMinor, p.currency),
    status: p.status,
    destination: toDestination(p.destination),
    failureCode: p.failureCode,
    createdAt: p.createdAt.toISOString(),
    paidAt: p.paidAt?.toISOString() ?? null,
    cancelledAt: p.cancelledAt?.toISOString() ?? null,
    failedAt: p.failedAt?.toISOString() ?? null,
  };
}

export const money = (minor: bigint, currency: CurrencyCode = 'TRY') => toMoney(minor, currency);

export function sumBig<T>(items: readonly T[], pick: (item: T) => bigint): bigint {
  return items.reduce((acc, item) => acc + pick(item), 0n);
}
