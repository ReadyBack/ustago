import { describe, expect, it } from 'vitest';

import { planWave, waveRadius, waveSize } from './wave-plan.js';

const config = { sizes: [2, 3, 5], radiiKm: [15, 40, 0] };
const ranked = [
  { providerId: 'a', distanceKm: 5 },
  { providerId: 'b', distanceKm: 30 },
  { providerId: 'c', distanceKm: 10 },
  { providerId: 'd', distanceKm: null },
  { providerId: 'e', distanceKm: 12 },
];

describe('planWave', () => {
  it('wave 1 takes the best providers inside the first radius, in rank order', () => {
    const plan = planWave({
      wave: 1,
      ranked,
      preferredProviderId: null,
      preferredOnly: false,
      config,
    });
    expect(plan.selected.map((s) => s.providerId)).toEqual(['a', 'c']);
    expect(plan.hasMoreWaves).toBe(true);
  });

  it('later waves widen the radius; unknown distance only in the unbounded wave', () => {
    const w2 = planWave({
      wave: 2,
      ranked,
      preferredProviderId: null,
      preferredOnly: false,
      config,
    });
    expect(w2.selected.map((s) => s.providerId)).toEqual(['a', 'b', 'c']);
    const w3 = planWave({
      wave: 3,
      ranked,
      preferredProviderId: null,
      preferredOnly: false,
      config,
    });
    expect(w3.selected.map((s) => s.providerId)).toContain('d');
    expect(w3.hasMoreWaves).toBe(false);
  });

  it('puts the preferred provider first even outside the radius', () => {
    const plan = planWave({
      wave: 1,
      ranked,
      preferredProviderId: 'b',
      preferredOnly: false,
      config,
    });
    expect(plan.selected.map((s) => [s.providerId, s.isPreferred])).toEqual([
      ['b', true],
      ['a', false],
    ]);
  });

  it('"sadece bu usta" sends to nobody else and stops', () => {
    const plan = planWave({
      wave: 1,
      ranked,
      preferredProviderId: 'e',
      preferredOnly: true,
      config,
    });
    expect(plan.selected.map((s) => s.providerId)).toEqual(['e']);
    expect(plan.hasMoreWaves).toBe(false);
    const missing = planWave({
      wave: 1,
      ranked,
      preferredProviderId: 'zz',
      preferredOnly: true,
      config,
    });
    expect(missing.selected).toEqual([]);
  });

  it('always counts a provider serving the district itself as near', () => {
    const plan = planWave({
      wave: 1,
      ranked: [
        { providerId: 'x', distanceKm: null, areaFit: 'DISTRICT' as const },
        { providerId: 'y', distanceKm: null, areaFit: 'REGION' as const },
      ],
      preferredProviderId: null,
      preferredOnly: false,
      config,
    });
    expect(plan.selected.map((s) => s.providerId)).toEqual(['x']);
  });

  it('clamps wave numbers to the configured list', () => {
    expect(waveSize(config, 9)).toBe(5);
    expect(waveRadius(config, 9)).toBe(0);
    expect(waveSize(config, 0)).toBe(2);
  });
});
