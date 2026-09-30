import { describe, expect, it } from 'vitest';

import {
  compareScores,
  MATCH_POINTS,
  type MatchSignals,
  rankProviders,
  scoreProvider,
} from './match-score.js';

const now = new Date('2026-09-30T10:00:00Z');
const cfg = { now, coldStartDays: 60, responseMinSample: 5, distanceHorizonKm: 50 };
const DAY = 86_400_000;

const base: MatchSignals = {
  providerId: '00000000-0000-7000-8000-000000000001',
  areaFit: 'DISTRICT',
  distanceKm: 5,
  workingNow: true,
  ustaScore: { score: 80, isNewProvider: false },
  response: null,
  completedJobs: 20,
  providerCancelledJobs: 0,
  attributableJobs: 20,
  lastActiveAt: new Date(now.getTime() - DAY),
  approvedAt: new Date('2025-01-01'),
  verified: true,
  accountLimited: false,
  visibilityReduced: false,
  activeWarnings: 0,
};
const p = (n: number) => `00000000-0000-7000-8000-00000000000${n}`;

describe('MATCH_V1', () => {
  it('is deterministic and explains every point', () => {
    const a = scoreProvider(base, cfg);
    const b = scoreProvider(base, cfg);
    expect(a).toEqual(b);
    const sum = a.breakdown.reduce((s, l) => s + l.points, 0);
    expect(a.score).toBeCloseTo(Math.min(100, sum), 1);
    expect(a.score).toBeGreaterThan(0);
    expect(a.score).toBeLessThanOrEqual(100);
  });

  it('prefers nearer providers, all else equal', () => {
    const near = scoreProvider({ ...base, distanceKm: 3 }, cfg);
    const far = scoreProvider({ ...base, distanceKm: 40 }, cfg);
    expect(near.score).toBeGreaterThan(far.score);
    expect(scoreProvider({ ...base, distanceKm: 80 }, cfg).breakdown.find((l) => l.key === 'distance'))
      .toBeUndefined();
  });

  it('verification is a small bonus and cannot beat real quality', () => {
    const verifiedWeak = scoreProvider(
      { ...base, verified: true, ustaScore: { score: 55, isNewProvider: false } },
      cfg,
    );
    const unverifiedStrong = scoreProvider(
      { ...base, providerId: p(2), verified: false, ustaScore: { score: 90, isNewProvider: false } },
      cfg,
    );
    expect(unverifiedStrong.score).toBeGreaterThan(verifiedWeak.score);
    const line = verifiedWeak.breakdown.find((l) => l.key === 'verification');
    expect(line?.points).toBe(MATCH_POINTS.VERIFIED);
    expect(line?.label).toContain('kalite puanı değildir');
  });

  it('gives new providers a neutral score plus a bounded cold-start bonus', () => {
    const fresh = scoreProvider(
      {
        ...base,
        ustaScore: { score: 100, isNewProvider: true },
        completedJobs: 1,
        approvedAt: new Date(now.getTime() - 10 * DAY),
      },
      cfg,
    );
    expect(fresh.breakdown.find((l) => l.key === 'quality')?.points).toBe(18);
    expect(fresh.breakdown.find((l) => l.key === 'cold_start')?.points).toBe(MATCH_POINTS.COLD_START);
    const old = scoreProvider(
      { ...base, ustaScore: null, approvedAt: new Date(now.getTime() - 200 * DAY) },
      cfg,
    );
    expect(old.breakdown.find((l) => l.key === 'cold_start')).toBeUndefined();
    // A top established provider still ranks above a brand-new one.
    const top = scoreProvider({ ...base, ustaScore: { score: 95, isNewProvider: false } }, cfg);
    expect(top.score).toBeGreaterThan(fresh.score);
  });

  it('ignores response data below the minimum sample', () => {
    const thin = scoreProvider(
      { ...base, response: { dispatched: 2, responded: 2, medianMinutes: 1 } },
      cfg,
    );
    expect(thin.breakdown.find((l) => l.key === 'response')?.points).toBe(MATCH_POINTS.RESPONSE_NEUTRAL);
    const fast = scoreProvider(
      { ...base, response: { dispatched: 10, responded: 9, medianMinutes: 10 } },
      cfg,
    );
    const slow = scoreProvider(
      { ...base, response: { dispatched: 10, responded: 3, medianMinutes: 400 } },
      cfg,
    );
    expect(fast.score).toBeGreaterThan(slow.score);
  });

  it('applies penalties and never goes below 0', () => {
    const penalised = scoreProvider(
      {
        ...base,
        accountLimited: true,
        visibilityReduced: true,
        activeWarnings: 5,
        providerCancelledJobs: 10,
        attributableJobs: 10,
      },
      cfg,
    );
    expect(penalised.breakdown.find((l) => l.key === 'warnings')?.points).toBe(-6);
    expect(penalised.breakdown.find((l) => l.key === 'cancellations')?.points).toBe(-10);
    expect(penalised.score).toBeGreaterThanOrEqual(0);
    expect(penalised.score).toBeLessThan(scoreProvider(base, cfg).score);
  });

  it('caps the activity signal', () => {
    const active = scoreProvider(base, cfg);
    const idle = scoreProvider({ ...base, lastActiveAt: null }, cfg);
    expect(active.score - idle.score).toBe(MATCH_POINTS.ACTIVE_7D);
  });

  it('breaks ties by distance, then provider id', () => {
    const ranked = rankProviders(
      [
        { ...base, providerId: p(3) },
        { ...base, providerId: p(1) },
        { ...base, providerId: p(2) },
      ],
      cfg,
    );
    expect(ranked.map((r) => r.providerId)).toEqual([p(1), p(2), p(3)]);
    expect(
      compareScores(
        { providerId: p(1), score: 50, breakdown: [], distanceKm: null },
        { providerId: p(2), score: 50, breakdown: [], distanceKm: 3 },
      ),
    ).toBeGreaterThan(0);
  });
});
