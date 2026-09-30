import type { ProviderCard } from '@ustago/types';
import { describe, expect, it } from 'vitest';

import { decodeOffset, encodeOffset, filterProviders, sortProviders } from './provider-sort.js';

const card = (id: string, over: Partial<ProviderCard> = {}): ProviderCard => ({
  id,
  displayName: id,
  photoUrl: null,
  isVerified: false,
  rating: null,
  completedJobCount: 0,
  ustaScore: null,
  isNewProvider: true,
  categories: [],
  areaLabel: '',
  distance: null,
  availableToday: false,
  responseStats: null,
  isFavorite: false,
  approxPoint: null,
  ...over,
});

const items = [
  {
    card: card('c', { distance: { km: 3, approximate: true }, completedJobCount: 5 }),
    matchScore: 50,
  },
  { card: card('a', { rating: { average: 4.9, count: 10 }, isVerified: true }), matchScore: 70 },
  {
    card: card('b', {
      distance: { km: 1, approximate: true },
      rating: { average: 4.9, count: 30 },
      responseStats: { medianMinutes: 10, responseRatePercent: 90, sampleSize: 20 },
      availableToday: true,
    }),
    matchScore: 70,
  },
];

describe('sortProviders', () => {
  it('RECOMMENDED uses the match score, then distance, then id', () => {
    expect(sortProviders(items, 'RECOMMENDED').map((i) => i.card.id)).toEqual(['b', 'a', 'c']);
  });
  it('puts unknown values last', () => {
    expect(sortProviders(items, 'NEAREST').map((i) => i.card.id)).toEqual(['b', 'c', 'a']);
    expect(sortProviders(items, 'RESPONSE_TIME').map((i) => i.card.id)).toEqual(['b', 'a', 'c']);
  });
  it('RATING breaks equal averages by review count', () => {
    expect(sortProviders(items, 'RATING').map((i) => i.card.id)).toEqual(['b', 'a', 'c']);
  });
  it('COMPLETED_JOBS is a plain count', () => {
    expect(sortProviders(items, 'COMPLETED_JOBS')[0]?.card.id).toBe('c');
  });
});

describe('filterProviders', () => {
  it('applies each filter honestly (unknown never passes a threshold)', () => {
    expect(filterProviders(items, { verifiedOnly: true }).map((i) => i.card.id)).toEqual(['a']);
    expect(filterProviders(items, { availableToday: true }).map((i) => i.card.id)).toEqual(['b']);
    expect(filterProviders(items, { minRating: 4.5 }).map((i) => i.card.id)).toEqual(['a', 'b']);
    expect(filterProviders(items, { maxDistanceKm: 2 }).map((i) => i.card.id)).toEqual(['b']);
  });
});

describe('offset cursor', () => {
  it('round-trips and rejects garbage', () => {
    expect(decodeOffset(encodeOffset(40))).toBe(40);
    expect(decodeOffset('%%%')).toBe(0);
    expect(decodeOffset(undefined)).toBe(0);
  });
});
