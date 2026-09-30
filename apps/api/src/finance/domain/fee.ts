/**
 * Platform fee arithmetic (docs/adr/0020). Integers only: amounts are
 * BigInt minor units (kuruş), rates are basis points (1500 bps = %15).
 * No floating point anywhere, so 270000 × 1500 bps is exactly 40500.
 */

export const BPS_DENOMINATOR = 10_000n;
export const MAX_BPS = 10_000;

export class MoneyError extends Error {}

/** Positive, integral minor-unit amount. */
export function assertPositiveMinor(amount: bigint, what = 'amount'): void {
  if (amount <= 0n) throw new MoneyError(`${what} must be positive`);
}

export function assertBps(bps: number): void {
  if (!Number.isInteger(bps) || bps < 0 || bps > MAX_BPS) {
    throw new MoneyError(`bps must be an integer between 0 and ${MAX_BPS}`);
  }
}

/**
 * amount × numerator / denominator, rounded HALF_UP (0,5 kuruş and above
 * rounds up). Only defined for non-negative inputs, which is all the
 * ledger ever needs: amounts are positive and directions carry the sign.
 */
export function mulDivHalfUp(amount: bigint, numerator: bigint, denominator: bigint): bigint {
  if (amount < 0n || numerator < 0n || denominator <= 0n) {
    throw new MoneyError('mulDivHalfUp expects non-negative inputs and a positive denominator');
  }
  const product = amount * numerator;
  const quotient = product / denominator;
  const remainder = product % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

/** amount × bps / 10000, HALF_UP. */
export function percentOf(amount: bigint, bps: number): bigint {
  assertBps(bps);
  return mulDivHalfUp(amount, BigInt(bps), BPS_DENOMINATOR);
}

/**
 * A fee policy snapshot. Faz 5 uses the percentage; fixed, minimum and
 * maximum fees are supported by the formula so a future policy needs no
 * code change (no pricing engine beyond this).
 */
export interface FeePolicy {
  bps: number;
  fixedFeeMinor: bigint;
  minFeeMinor: bigint | null;
  maxFeeMinor: bigint | null;
}

/**
 * fee = clamp(fixed + round(gross × bps), min, max), never more than the
 * gross itself, never negative.
 */
export function feeFor(gross: bigint, policy: FeePolicy): bigint {
  if (gross < 0n) throw new MoneyError('gross must not be negative');
  if (gross === 0n) return 0n;
  let fee = policy.fixedFeeMinor + percentOf(gross, policy.bps);
  if (policy.minFeeMinor !== null && fee < policy.minFeeMinor) fee = policy.minFeeMinor;
  if (policy.maxFeeMinor !== null && fee > policy.maxFeeMinor) fee = policy.maxFeeMinor;
  if (fee > gross) fee = gross;
  return fee < 0n ? 0n : fee;
}

/**
 * Fee for one more payment on a job that was already partly paid. It is
 * computed on the cumulative total, so the fees of all payments of a job
 * always add up to feeFor(job total): ₺2.200 then ₺500 at %15 → 330 + 75
 * = 405, the same as ₺2.700 at once (and a minimum fee is charged once).
 */
export function incrementalFee(capturedBefore: bigint, amount: bigint, policy: FeePolicy): bigint {
  assertPositiveMinor(amount);
  if (capturedBefore < 0n) throw new MoneyError('capturedBefore must not be negative');
  return feeFor(capturedBefore + amount, policy) - feeFor(capturedBefore, policy);
}

export interface FeeSplit {
  gross: bigint;
  fee: bigint;
  net: bigint;
}

/** gross = fee + net, always. */
export function splitGross(gross: bigint, fee: bigint): FeeSplit {
  if (fee < 0n || fee > gross) throw new MoneyError('fee must be between 0 and gross');
  return { gross, fee, net: gross - fee };
}
