import { floorToTen, percentile, priceStats, withoutOutliers } from './price-stats.js';

const points = (amounts: number[], providers = 5) =>
  amounts.map((amountMinor, i) => ({ amountMinor, providerId: `p${i % providers}` }));

const T = { minSample: 10, minProviders: 3 };

describe('price guide statistics', () => {
  it('interpolates percentiles like percentile_cont', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(percentile([10], 0.75)).toBe(10);
    expect(percentile([100, 200], 0.25)).toBe(125);
  });

  it('drops values outside the Tukey fences only', () => {
    const base = points([1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900]);
    const withOutliers = [...base, ...points([100_000, 1], 1)];
    const kept = withoutOutliers(withOutliers).map((p) => p.amountMinor);
    expect(kept).not.toContain(100_000);
    expect(kept).not.toContain(1);
    expect(kept).toHaveLength(10);
    // Nothing is dropped from a tight sample.
    expect(withoutOutliers(base)).toHaveLength(10);
  });

  it('keeps tiny samples as they are (no fences under 4 values)', () => {
    expect(withoutOutliers(points([1, 1000, 1_000_000]))).toHaveLength(3);
  });

  it('refuses below the minimum sample or provider count', () => {
    expect(priceStats(points([150_000, 160_000, 170_000]), T)).toMatchObject({
      ok: false,
      sampleSize: 3,
    });
    const oneProvider = points(
      Array.from({ length: 20 }, () => 150_000),
      1,
    );
    expect(priceStats(oneProvider, T)).toMatchObject({ ok: false, providerCount: 1 });
  });

  it('counts the sample after removing outliers', () => {
    // 9 normal jobs + 1 absurd one: 10 in total but only 9 remain.
    const amounts = [...Array.from({ length: 9 }, (_, i) => 150_000 + i * 1_000), 9_000_000];
    expect(priceStats(points(amounts), T)).toMatchObject({ ok: false, sampleSize: 9 });
  });

  it('returns p25/median/p75 rounded to whole lira and a floored sample size', () => {
    const amounts = [
      ...Array.from({ length: 12 }, (_, i) => 100_000 + i * 10_000), // 1000-2100 TL
      50_000_000, // outlier
    ];
    const stats = priceStats(points(amounts), T);
    expect(stats).toEqual({
      ok: true,
      p25Minor: 127_500,
      medianMinor: 155_000,
      p75Minor: 182_500,
      sampleSize: 12,
      sampleSizeFloor: 10,
      providerCount: 5,
    });
  });

  it('ignores non-positive or non-finite amounts', () => {
    const amounts = [...Array.from({ length: 10 }, () => 200_000), 0, -5, Number.NaN];
    expect(priceStats(points(amounts), T)).toMatchObject({ ok: true, sampleSize: 10 });
  });

  it('floors to a multiple of ten', () => {
    expect(floorToTen(9)).toBe(0);
    expect(floorToTen(10)).toBe(10);
    expect(floorToTen(47)).toBe(40);
  });
});
