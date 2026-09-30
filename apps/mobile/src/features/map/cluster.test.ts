import { boundsOf, clusterPoints, relativePosition, suggestedCellSizeKm } from './cluster';

// Adana, roughly: Seyhan and Çukurova district centres are ~5 km apart.
const seyhan = { id: 'a', lat: 36.99, lng: 35.32 };
const seyhan2 = { id: 'b', lat: 36.991, lng: 35.321 };
const cukurova = { id: 'c', lat: 37.05, lng: 35.28 };
const mersin = { id: 'd', lat: 36.8, lng: 34.63 };

describe('clusterPoints', () => {
  it('returns nothing for no points', () => {
    expect(clusterPoints([], 5)).toEqual([]);
  });

  it('groups points in the same cell and keeps far points apart', () => {
    const clusters = clusterPoints([cukurova, seyhan, mersin, seyhan2], 2);
    const sizes = clusters.map((c) => c.points.map((p) => p.id).join(','));
    expect(sizes).toContain('a,b');
    expect(sizes).toContain('c');
    expect(sizes).toContain('d');
    expect(clusters).toHaveLength(3);
    // Biggest cluster first.
    expect(clusters[0]?.points).toHaveLength(2);
  });

  it('merges everything with a large cell', () => {
    const clusters = clusterPoints([seyhan, cukurova, seyhan2], 500);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.points.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    // Centre is the mean of the members.
    expect(clusters[0]?.lat).toBeCloseTo((36.99 + 36.991 + 37.05) / 3, 6);
  });

  it('is deterministic regardless of input order', () => {
    const one = clusterPoints([seyhan, cukurova, mersin, seyhan2], 2);
    const two = clusterPoints([mersin, seyhan2, cukurova, seyhan], 2);
    expect(one).toEqual(two);
    expect(one[0]?.id).toBe('c:a');
  });

  it('ignores non-finite coordinates and falls back from a bad cell size', () => {
    const clusters = clusterPoints([seyhan, { id: 'x', lat: Number.NaN, lng: 1 }], 0);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.points.map((p) => p.id)).toEqual(['a']);
  });
});

describe('relative positions', () => {
  it('places a single point in the middle and keeps others within the margin', () => {
    const single = boundsOf([seyhan]);
    expect(single && relativePosition(seyhan, single)).toEqual({ x: 0.5, y: 0.5 });

    const b = boundsOf([seyhan, mersin]);
    if (!b) throw new Error('bounds');
    const north = relativePosition(seyhan, b);
    const south = relativePosition(mersin, b);
    expect(north.y).toBeLessThan(south.y);
    for (const v of [north.x, north.y, south.x, south.y]) {
      expect(v).toBeGreaterThanOrEqual(0.12);
      expect(v).toBeLessThanOrEqual(0.88);
    }
  });

  it('suggests a cell size of at least 1 km', () => {
    expect(suggestedCellSizeKm(null)).toBe(2);
    expect(suggestedCellSizeKm(boundsOf([seyhan]))).toBe(1);
    expect(suggestedCellSizeKm(boundsOf([seyhan, mersin]))).toBeGreaterThan(5);
  });
});
