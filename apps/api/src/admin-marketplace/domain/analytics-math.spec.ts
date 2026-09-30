import {
  compareRegions,
  funnelSteps,
  medianPriceOrNull,
  parseBreakdown,
  percent,
  type RawRegionRow,
  roundMedian,
  suppressSmall,
  toRegionStats,
} from './analytics-math.js';

const base: RawRegionRow = {
  province: { id: 1, name: 'Adana' },
  district: null,
  requests: 0,
  quotes: 0,
  completedJobs: 0,
  unservedRequests: 0,
  activeProviders: 0,
  availableProviders: 0,
  launchStatus: 'ACTIVE',
};

describe('percent', () => {
  it('is null without a denominator', () => {
    expect(percent(0, 0)).toBeNull();
    expect(percent(3, 0)).toBeNull();
  });
  it('rounds to one decimal', () => {
    expect(percent(1, 3)).toBe(33.3);
    expect(percent(2, 2)).toBe(100);
  });
});

describe('roundMedian', () => {
  it('keeps null and rounds numbers', () => {
    expect(roundMedian(null)).toBeNull();
    expect(roundMedian(12.345)).toBe(12.3);
  });
});

describe('funnelSteps', () => {
  it('returns the seven steps in order with labels', () => {
    const steps = funnelSteps({
      created: 10,
      dispatched: 9,
      viewed: 7,
      quoted: 5,
      accepted: 3,
      started: 2,
      completed: 1,
    });
    expect(steps.map((s) => s.key)).toEqual([
      'created',
      'dispatched',
      'viewed',
      'quoted',
      'accepted',
      'started',
      'completed',
    ]);
    expect(steps[3]).toMatchObject({ key: 'quoted', requests: 5 });
    expect(steps.every((s) => s.label.length > 0)).toBe(true);
  });
});

describe('region privacy', () => {
  it('withholds counts between 1 and 4', () => {
    expect(suppressSmall(0)).toBe(0);
    expect(suppressSmall(1)).toBeNull();
    expect(suppressSmall(4)).toBeNull();
    expect(suppressSmall(5)).toBe(5);
  });

  it('withholds every request-derived number below 5 requests', () => {
    const row = toRegionStats({
      ...base,
      requests: 3,
      quotes: 0,
      unservedRequests: 0,
      activeProviders: 2,
      availableProviders: 1,
    });
    expect(row.requests).toBeNull();
    expect(row.quotes).toBeNull();
    expect(row.completedJobs).toBeNull();
    expect(row.unservedRequests).toBeNull();
    // requests / providers would reveal the withheld count.
    expect(row.demandPerProvider).toBeNull();
    // Supply is public listing data and stays visible.
    expect(row.activeProviders).toBe(2);
    expect(row.availableProviders).toBe(1);
  });

  it('shows counts from 5 requests, withholding small sub-counts', () => {
    const row = toRegionStats({
      ...base,
      requests: 8,
      quotes: 12,
      completedJobs: 2,
      unservedRequests: 0,
      availableProviders: 4,
      activeProviders: 5,
    });
    expect(row.requests).toBe(8);
    expect(row.quotes).toBe(12);
    expect(row.completedJobs).toBeNull();
    expect(row.unservedRequests).toBe(0);
    expect(row.demandPerProvider).toBe(2);
  });

  it('demand per provider is null without available providers', () => {
    expect(toRegionStats({ ...base, requests: 10 }).demandPerProvider).toBeNull();
  });

  it('zero requests are shown as zero', () => {
    const row = toRegionStats({ ...base, activeProviders: 3, availableProviders: 3 });
    expect(row.requests).toBe(0);
    expect(row.demandPerProvider).toBe(0);
  });

  it('sorts visible demand first and withheld rows as zero demand', () => {
    const a = toRegionStats({ ...base, province: { id: 1, name: 'Adana' }, requests: 3 });
    const b = toRegionStats({ ...base, province: { id: 6, name: 'Ankara' }, requests: 20 });
    const c = toRegionStats({
      ...base,
      province: { id: 34, name: 'İstanbul' },
      requests: 0,
      activeProviders: 4,
    });
    expect([a, b, c].sort(compareRegions).map((r) => r.province.id)).toEqual([6, 34, 1]);
  });
});

describe('medianPriceOrNull', () => {
  it('needs both the sample and distinct providers', () => {
    expect(medianPriceOrNull(150000.4, 9, 5, 10, 3)).toBeNull();
    expect(medianPriceOrNull(150000.4, 10, 2, 10, 3)).toBeNull();
    expect(medianPriceOrNull(150000.4, 10, 3, 10, 3)).toBe(150000);
    expect(medianPriceOrNull(null, 50, 10, 10, 3)).toBeNull();
  });
});

describe('parseBreakdown', () => {
  it('keeps well-formed lines only', () => {
    expect(
      parseBreakdown([
        { key: 'area', label: 'İlçe', points: 10 },
        { key: 'x', label: 'bad', points: 'NaN' },
        { label: 'no key', points: 1 },
        null,
        { key: 'distance', label: 'Mesafe', points: '4.5' },
      ]),
    ).toEqual([
      { key: 'area', label: 'İlçe', points: 10 },
      { key: 'distance', label: 'Mesafe', points: 4.5 },
    ]);
    expect(parseBreakdown({})).toEqual([]);
  });
});
