/**
 * Price guide statistics (Faz 7, docs/adr/0028). Pure: the caller loads the
 * final totals of real completed jobs.
 *
 * 1. Outliers: with Q1/Q3 of all values (linear interpolation, the same
 *    method as PostgreSQL percentile_cont), values outside
 *    [Q1 − 1.5·IQR, Q3 + 1.5·IQR] (Tukey's fences) are dropped, so one
 *    mistyped or exceptional job cannot move the guide.
 * 2. p25 / median / p75 are computed on the remaining values and rounded
 *    to whole lira (100 minor units) for display.
 * 3. Shown only when the remaining sample has at least `minSample` jobs
 *    from at least `minProviders` distinct providers.
 *    `sampleSizeFloor` is the remaining count rounded down to a multiple
 *    of 10 ("10+ iş"), so the exact volume is not disclosed.
 */
export interface PricePoint {
  amountMinor: number;
  providerId: string;
}

export type PriceStats =
  | { ok: false; sampleSize: number; providerCount: number }
  | {
      ok: true;
      p25Minor: number;
      medianMinor: number;
      p75Minor: number;
      sampleSize: number;
      sampleSizeFloor: number;
      providerCount: number;
    };

/** percentile_cont semantics on an ascending, non-empty array. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new Error('percentile of an empty list');
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (pos - lo);
}

export function withoutOutliers<T extends { amountMinor: number }>(points: readonly T[]): T[] {
  if (points.length < 4) return [...points];
  const sorted = points.map((p) => p.amountMinor).sort((a, b) => a - b);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const iqr = q3 - q1;
  const low = q1 - 1.5 * iqr;
  const high = q3 + 1.5 * iqr;
  return points.filter((p) => p.amountMinor >= low && p.amountMinor <= high);
}

export const roundToLira = (minor: number): number => Math.round(minor / 100) * 100;

export const floorToTen = (n: number): number => Math.floor(n / 10) * 10;

export function priceStats(
  points: readonly PricePoint[],
  thresholds: { minSample: number; minProviders: number },
): PriceStats {
  const kept = withoutOutliers(
    points.filter((p) => Number.isFinite(p.amountMinor) && p.amountMinor > 0),
  );
  const providerCount = new Set(kept.map((p) => p.providerId)).size;
  if (kept.length < thresholds.minSample || providerCount < thresholds.minProviders) {
    return { ok: false, sampleSize: kept.length, providerCount };
  }
  const sorted = kept.map((p) => p.amountMinor).sort((a, b) => a - b);
  return {
    ok: true,
    p25Minor: roundToLira(percentile(sorted, 0.25)),
    medianMinor: roundToLira(percentile(sorted, 0.5)),
    p75Minor: roundToLira(percentile(sorted, 0.75)),
    sampleSize: kept.length,
    sampleSizeFloor: floorToTen(kept.length),
    providerCount,
  };
}
