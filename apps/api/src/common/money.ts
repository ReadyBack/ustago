import type { Money } from '@ustago/types';

import type { CurrencyCode } from '../generated/prisma/client.js';

/**
 * The single BigInt → JSON boundary for money (docs/adr/0006). Minor units
 * are stored as BIGINT; the API sends numbers, which is exact up to
 * Number.MAX_SAFE_INTEGER kuruş (~90 trillion TL). Anything larger is a
 * data error and fails loudly instead of being rounded.
 */
export function toMoney(minor: bigint, currency: CurrencyCode): Money {
  if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError('Money amount exceeds the safe integer range');
  }
  return { amountMinor: Number(minor), currency };
}

export function toMoneyOrNull(minor: bigint | null, currency: CurrencyCode): Money | null {
  return minor === null ? null : toMoney(minor, currency);
}

/** Validated integer from a request body → BIGINT column value. */
export function toMinor(amountMinor: number): bigint {
  if (!Number.isSafeInteger(amountMinor)) throw new RangeError('Money must be a safe integer');
  return BigInt(amountMinor);
}
