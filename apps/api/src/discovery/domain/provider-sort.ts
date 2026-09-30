import type { ProviderCard, ProviderSort } from '@ustago/types';

/**
 * Customer-side sorts (docs/adr/0028). RECOMMENDED is the MATCH_V1 score;
 * the others are single, visible facts. Every sort ends with the provider
 * id so the order (and offset paging) is stable.
 */
export interface SortableProvider {
  card: ProviderCard;
  matchScore: number;
}

const byId = (a: SortableProvider, b: SortableProvider) =>
  a.card.id < b.card.id ? -1 : a.card.id > b.card.id ? 1 : 0;

const nullsLast = (a: number | null, b: number | null, asc: boolean) => {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return asc ? a - b : b - a;
};

export function sortProviders(items: SortableProvider[], sort: ProviderSort): SortableProvider[] {
  const cmp: Record<ProviderSort, (a: SortableProvider, b: SortableProvider) => number> = {
    RECOMMENDED: (a, b) =>
      b.matchScore - a.matchScore ||
      nullsLast(a.card.distance?.km ?? null, b.card.distance?.km ?? null, true),
    NEAREST: (a, b) => nullsLast(a.card.distance?.km ?? null, b.card.distance?.km ?? null, true),
    RATING: (a, b) =>
      nullsLast(a.card.rating?.average ?? null, b.card.rating?.average ?? null, false) ||
      (b.card.rating?.count ?? 0) - (a.card.rating?.count ?? 0),
    COMPLETED_JOBS: (a, b) => b.card.completedJobCount - a.card.completedJobCount,
    RESPONSE_TIME: (a, b) =>
      nullsLast(
        a.card.responseStats?.medianMinutes ?? null,
        b.card.responseStats?.medianMinutes ?? null,
        true,
      ),
  };
  return [...items].sort((a, b) => cmp[sort](a, b) || byId(a, b));
}

export interface ProviderFilters {
  minRating?: number | undefined;
  verifiedOnly?: boolean | undefined;
  availableToday?: boolean | undefined;
  maxDistanceKm?: number | undefined;
}

export function filterProviders(items: SortableProvider[], f: ProviderFilters): SortableProvider[] {
  return items.filter(({ card }) => {
    if (f.verifiedOnly && !card.isVerified) return false;
    if (f.availableToday && !card.availableToday) return false;
    if (f.minRating !== undefined && (card.rating === null || card.rating.average < f.minRating)) {
      return false;
    }
    if (
      f.maxDistanceKm !== undefined &&
      (card.distance === null || card.distance.km > f.maxDistanceKm)
    ) {
      return false;
    }
    return true;
  });
}

export function encodeOffset(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
}

export function decodeOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o?: unknown };
    return typeof v.o === 'number' && Number.isInteger(v.o) && v.o >= 0 && v.o < 100_000 ? v.o : 0;
  } catch {
    return 0;
  }
}
