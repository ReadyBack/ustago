import { describe, expect, it } from 'vitest';

import { comparisonLabels } from './quote-comparison.js';

const q = (id: string, totalMinor: number, distanceKm: number | null, avg?: number, count = 5) => ({
  id,
  open: true,
  totalMinor,
  distanceKm,
  rating: avg === undefined ? null : { average: avg, count },
});

describe('comparisonLabels', () => {
  it('labels unique winners only', () => {
    const labels = comparisonLabels([
      q('a', 200000, 3, 4.9),
      q('b', 150000, 8, 4.5),
      q('c', 180000, 12),
    ]);
    expect(labels.get('a')).toEqual(['NEAREST', 'HIGHEST_RATED']);
    expect(labels.get('b')).toEqual(['LOWEST_PRICE']);
    expect(labels.get('c')).toEqual([]);
  });

  it('gives no label on a tie', () => {
    const labels = comparisonLabels([q('a', 150000, 3), q('b', 150000, 3)]);
    expect(labels.get('a')).toEqual([]);
    expect(labels.get('b')).toEqual([]);
  });

  it('needs at least two open offers', () => {
    expect(comparisonLabels([q('a', 1, 1, 5)]).get('a')).toEqual([]);
    const closed = { ...q('b', 2, 2), open: false };
    expect(comparisonLabels([q('a', 1, 1), closed]).get('a')).toEqual([]);
  });

  it('ignores thin ratings and unknown distances', () => {
    const labels = comparisonLabels([q('a', 100, null, 5, 1), q('b', 200, null, 4, 1)]);
    expect(labels.get('a')).toEqual(['LOWEST_PRICE']);
    expect(labels.get('b')).toEqual([]);
  });
});
