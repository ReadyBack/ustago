import {
  cancellationFactor,
  completionFactor,
  computeUstaScore,
  disputeFactor,
  experienceFactor,
  NEW_PROVIDER_RANKING_SCORE,
  publicUstaScore,
  type QualityInputs,
  rankingScore,
  responseFactor,
  reviewFactor,
  USTA_SCORE_VERSION,
  verificationFactor,
  WEIGHTS,
} from './usta-score.js';

const NOW = new Date('2026-10-01T12:00:00Z');

const inputs = (over: Partial<QualityInputs> = {}): QualityInputs => ({
  reviewCount: 0,
  reviewRatingSum: 0,
  completedJobs: 0,
  providerCancelledJobs: 0,
  attributableJobs: 0,
  decidedDisputedJobs: 0,
  disputesForCustomer: 0,
  disputesPartial: 0,
  responseMedianSeconds: null,
  responseSamples: 0,
  identityVerified: false,
  certificateVerified: false,
  yearsOfExperience: null,
  penalties: [],
  ...over,
});

describe('UstaScore V1 factors', () => {
  it('weights add up to 100 %', () => {
    const total = Object.values(WEIGHTS).reduce((s, w) => s + w, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('shrinks few reviews towards the prior (one 5-star is not a 100)', () => {
    expect(reviewFactor(0, 0)).toBeNull();
    const one = reviewFactor(1, 5) ?? 0;
    const hundred = reviewFactor(100, 490) ?? 0;
    expect(one).toBeLessThan(hundred);
    expect(one).toBeCloseTo(((25 / 6 - 1) / 4) * 100, 5);
  });

  it('computes completion from the jobs whose outcome is the provider’s', () => {
    expect(completionFactor(inputs({ completedJobs: 2 }))).toBeNull();
    expect(completionFactor(inputs({ completedJobs: 9, providerCancelledJobs: 1 }))).toBe(90);
  });

  it('does not count customer cancellations against the provider', () => {
    // 10 attributable jobs (customer cancellations are excluded upstream), 1 by provider.
    expect(cancellationFactor(inputs({ attributableJobs: 10, providerCancelledJobs: 1 }))).toBe(90);
    expect(cancellationFactor(inputs({ attributableJobs: 2 }))).toBeNull();
  });

  it('counts only decided disputes: for customer 1, partial 0.5, for provider 0', () => {
    const base = { completedJobs: 8, decidedDisputedJobs: 2 };
    expect(disputeFactor(inputs({ ...base }))).toBe(100);
    expect(disputeFactor(inputs({ ...base, disputesForCustomer: 1 }))).toBe(90);
    expect(disputeFactor(inputs({ ...base, disputesPartial: 1 }))).toBe(95);
  });

  it('buckets median reply time and needs enough samples', () => {
    expect(responseFactor(600, 5)).toBe(100);
    expect(responseFactor(3000, 5)).toBe(85);
    expect(responseFactor(3 * 3600, 5)).toBe(65);
    expect(responseFactor(2 * 86400, 5)).toBe(0);
    expect(responseFactor(600, 2)).toBeNull();
  });

  it('scores verification and experience with fixed parts', () => {
    expect(verificationFactor(true, false)).toBe(70);
    expect(verificationFactor(true, true)).toBe(100);
    expect(experienceFactor(50, 20)).toBe(100);
    expect(experienceFactor(0, 10)).toBe(15);
  });
});

describe('computeUstaScore', () => {
  it('renormalises over the available factors instead of inventing values', () => {
    const r = computeUstaScore(inputs({ identityVerified: true, certificateVerified: true }), NOW);
    // Only VERIFICATION (100) and EXPERIENCE (0) are available, 0.05 each.
    expect(r.score).toBe(50);
    const reviews = r.factors.find((f) => f.key === 'REVIEWS');
    expect(reviews).toMatchObject({ score: null, effectiveWeight: 0 });
    const effective = r.factors.reduce((s, f) => s + f.effectiveWeight, 0);
    expect(effective).toBeCloseTo(1, 2);
  });

  it('marks providers with fewer than 3 completed jobs as new', () => {
    expect(computeUstaScore(inputs({ completedJobs: 2 }), NOW).isNewProvider).toBe(true);
    expect(computeUstaScore(inputs({ completedJobs: 3 }), NOW).isNewProvider).toBe(false);
  });

  it('ranks an established 4.9 provider above a new provider with one 5-star review', () => {
    const veteran = computeUstaScore(
      inputs({
        reviewCount: 100,
        reviewRatingSum: 490,
        completedJobs: 100,
        attributableJobs: 102,
        providerCancelledJobs: 2,
        identityVerified: true,
        yearsOfExperience: 10,
      }),
      NOW,
    );
    const rookie = computeUstaScore(
      inputs({ reviewCount: 1, reviewRatingSum: 5, completedJobs: 1, attributableJobs: 1 }),
      NOW,
    );
    expect(veteran.score ?? 0).toBeGreaterThan(rookie.score ?? 0);
    expect(rankingScore({ score: rookie.score ?? 0, isNewProvider: rookie.isNewProvider })).toBe(
      NEW_PROVIDER_RANKING_SCORE,
    );
  });

  it('subtracts active penalty points and ignores expired or revoked ones', () => {
    const base = inputs({ identityVerified: true, certificateVerified: true });
    const withPenalty = (status: 'ACTIVE' | 'REVOKED', endsAt: Date | null) =>
      computeUstaScore(
        {
          ...base,
          penalties: [
            { type: 'VISIBILITY_REDUCTION', status, startsAt: new Date('2026-09-01'), endsAt },
          ],
        },
        NOW,
      );
    expect(withPenalty('ACTIVE', null)).toMatchObject({ score: 40, penaltyPoints: 10 });
    expect(withPenalty('REVOKED', null).score).toBe(50);
    expect(withPenalty('ACTIVE', new Date('2026-09-15')).score).toBe(50);
  });

  it('stays within 0-100', () => {
    const r = computeUstaScore(
      inputs({
        penalties: [
          {
            type: 'JOB_RESTRICTION',
            status: 'ACTIVE',
            startsAt: new Date('2026-09-01'),
            endsAt: null,
          },
          {
            type: 'NOW_SUSPENSION',
            status: 'ACTIVE',
            startsAt: new Date('2026-09-01'),
            endsAt: null,
          },
        ],
      }),
      NOW,
    );
    expect(r.score).toBe(0);
  });
});

describe('public and ranking views', () => {
  it('hides the score of new providers and of old algorithm versions', () => {
    expect(publicUstaScore(null)).toBeNull();
    expect(
      publicUstaScore({ score: 80, isNewProvider: true, algorithmVersion: USTA_SCORE_VERSION }),
    ).toBeNull();
    expect(
      publicUstaScore({ score: 81.62, isNewProvider: false, algorithmVersion: 'seed' }),
    ).toBeNull();
    expect(
      publicUstaScore({ score: 81.62, isNewProvider: false, algorithmVersion: USTA_SCORE_VERSION }),
    ).toBe(82);
  });

  it('gives unscored and new providers the neutral ranking score', () => {
    expect(rankingScore(null)).toBe(NEW_PROVIDER_RANKING_SCORE);
    expect(rankingScore({ score: 90, isNewProvider: true })).toBe(NEW_PROVIDER_RANKING_SCORE);
    expect(rankingScore({ score: 72.5, isNewProvider: false })).toBe(72.5);
  });
});
