import type { QuoteComparisonLabel } from '@ustago/types';

/**
 * Offer comparison labels (docs/adr/0028). Only objective facts, only
 * among open offers, only with at least two of them, and only for a unique
 * winner: a tie gets no label. Never "en iyi" or "önerilen".
 */
export interface ComparableQuote {
  id: string;
  open: boolean;
  totalMinor: number;
  distanceKm: number | null;
  rating: { average: number; count: number } | null;
}

/** Ratings need a few reviews before "En yüksek puan" means anything. */
export const MIN_REVIEWS_FOR_RATING_LABEL = 3;

function uniqueBest<T>(
  items: readonly T[],
  value: (t: T) => number | null,
  better: (a: number, b: number) => boolean,
): T | null {
  let best: T | null = null;
  let bestValue: number | null = null;
  let tie = false;
  for (const item of items) {
    const v = value(item);
    if (v === null) continue;
    if (bestValue === null || better(v, bestValue)) {
      best = item;
      bestValue = v;
      tie = false;
    } else if (v === bestValue) {
      tie = true;
    }
  }
  return tie ? null : best;
}

export function comparisonLabels(
  quotes: readonly ComparableQuote[],
): Map<string, QuoteComparisonLabel[]> {
  const out = new Map<string, QuoteComparisonLabel[]>(quotes.map((q) => [q.id, []]));
  const open = quotes.filter((q) => q.open);
  if (open.length < 2) return out;
  const push = (q: ComparableQuote | null, label: QuoteComparisonLabel) => {
    if (q) out.get(q.id)?.push(label);
  };
  push(uniqueBest(open, (q) => q.totalMinor, (a, b) => a < b), 'LOWEST_PRICE');
  push(uniqueBest(open, (q) => (q.distanceKm === null ? null : Math.round(q.distanceKm)), (a, b) => a < b), 'NEAREST');
  push(
    uniqueBest(
      open,
      (q) =>
        q.rating && q.rating.count >= MIN_REVIEWS_FOR_RATING_LABEL
          ? Math.round(q.rating.average * 10)
          : null,
      (a, b) => a > b,
    ),
    'HIGHEST_RATED',
  );
  return out;
}
