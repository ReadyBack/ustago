import type { QualityFactor, QualityFactorKey } from '@ustago/types';

import { penaltyPoints, type PenaltyWindow } from './penalty-policy.js';

/**
 * UstaScore V1 (docs/adr/0016-ustascore-v1-ve-usta-kalite-modeli.md).
 *
 * Two different numbers:
 * - "Kullanıcı Puanı": the plain average of published reviews (shown as
 *   ⭐ 4.8 · 12 değerlendirme).
 * - UstaScore (0-100): the trust score used for ranking. It combines
 *   several verifiable signals so a single 5-star review cannot put a new
 *   provider above one with a hundred 4.9s.
 *
 *   score = Σ(wᵢ · sᵢ) / Σ(wᵢ over available factors) − penalty points
 *
 * A factor without reliable data is left out and the remaining weights
 * are renormalised; nothing is filled in with an invented value.
 */
export const USTA_SCORE_VERSION = 'v1';

export const WEIGHTS: Readonly<Record<QualityFactorKey, number>> = {
  REVIEWS: 0.4,
  COMPLETION: 0.2,
  CANCELLATION: 0.1,
  DISPUTES: 0.1,
  RESPONSE: 0.1,
  VERIFICATION: 0.05,
  EXPERIENCE: 0.05,
};

/** Bayesian prior: every provider starts as if they had 5 reviews of 4.0. */
export const REVIEW_PRIOR_MEAN = 4.0;
export const REVIEW_PRIOR_WEIGHT = 5;
/** Rates (completion, cancellation, disputes) need at least this many jobs. */
export const MIN_JOBS_FOR_RATES = 3;
/** Median reply time needs at least this many replies. */
export const MIN_RESPONSE_SAMPLES = 3;
/** Below this many completed jobs a provider is "Yeni Usta" and no score is shown. */
export const NEW_PROVIDER_MIN_COMPLETED_JOBS = 3;

export interface QualityInputs {
  /** Published customer reviews. */
  reviewCount: number;
  reviewRatingSum: number;
  completedJobs: number;
  /** Cancelled by the provider after agreement. */
  providerCancelledJobs: number;
  /**
   * Jobs that are not cancelled by the customer or the system: the
   * denominator of the cancellation rate (active jobs included, since a
   * cancellation happens before the work).
   */
  attributableJobs: number;
  /** Jobs whose dispute was decided (for either side). */
  decidedDisputedJobs: number;
  disputesForCustomer: number;
  disputesPartial: number;
  /** Median seconds from a customer's counter offer to the provider's reply. */
  responseMedianSeconds: number | null;
  responseSamples: number;
  identityVerified: boolean;
  certificateVerified: boolean;
  /** Self-declared; low weight on purpose. */
  yearsOfExperience: number | null;
  penalties: readonly PenaltyWindow[];
}

export interface UstaScoreResult {
  /** 0-100 with two decimals, penalties applied. Null only when no factor is available. */
  score: number | null;
  isNewProvider: boolean;
  factors: QualityFactor[];
  penaltyPoints: number;
  sampleSize: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number) => Math.min(100, Math.max(0, n));

/** Bayesian average of the reviews, mapped from 1-5 stars to 0-100. */
export function reviewFactor(count: number, sum: number): number | null {
  if (count <= 0) return null;
  const bayes = (REVIEW_PRIOR_WEIGHT * REVIEW_PRIOR_MEAN + sum) / (REVIEW_PRIOR_WEIGHT + count);
  return clamp(((bayes - 1) / 4) * 100);
}

/**
 * Completed out of the jobs whose outcome is the provider's: completed,
 * cancelled by the provider, or disputed and decided against them.
 * Customer cancellations and jobs still running do not count.
 */
export function completionFactor(i: QualityInputs): number | null {
  const against = i.disputesForCustomer + i.disputesPartial;
  const denominator = i.completedJobs + i.providerCancelledJobs + against;
  if (denominator < MIN_JOBS_FOR_RATES) return null;
  return clamp((i.completedJobs / denominator) * 100);
}

export function cancellationFactor(i: QualityInputs): number | null {
  if (i.attributableJobs < MIN_JOBS_FOR_RATES) return null;
  return clamp((1 - i.providerCancelledJobs / i.attributableJobs) * 100);
}

/**
 * Only disputes an admin decided count; an open dispute is not a verdict.
 * Decided for the customer = 1, partial = 0.5, for the provider or closed = 0.
 */
export function disputeFactor(i: QualityInputs): number | null {
  const denominator = i.completedJobs + i.decidedDisputedJobs;
  if (denominator < MIN_JOBS_FOR_RATES) return null;
  const attributed = i.disputesForCustomer + 0.5 * i.disputesPartial;
  return clamp((1 - attributed / denominator) * 100);
}

const RESPONSE_BUCKETS: readonly [number, number][] = [
  [15 * 60, 100],
  [60 * 60, 85],
  [4 * 3600, 65],
  [12 * 3600, 40],
  [24 * 3600, 20],
];

/** How fast the provider answers a customer's counter offer (median). */
export function responseFactor(medianSeconds: number | null, samples: number): number | null {
  if (medianSeconds === null || samples < MIN_RESPONSE_SAMPLES) return null;
  for (const [limit, score] of RESPONSE_BUCKETS) if (medianSeconds <= limit) return score;
  return 0;
}

/** Admin-approved documents: identity 70, professional certificate 30. */
export function verificationFactor(identity: boolean, certificate: boolean): number {
  return (identity ? 70 : 0) + (certificate ? 30 : 0);
}

/**
 * Mostly completed jobs on UstaGO (70), a little self-declared years (30):
 * "10 yıl deneyim" alone is a weak signal.
 */
export function experienceFactor(completedJobs: number, years: number | null): number {
  return (Math.min(completedJobs, 50) / 50) * 70 + (Math.min(years ?? 0, 20) / 20) * 30;
}

function describe(key: QualityFactorKey, i: QualityInputs): string {
  switch (key) {
    case 'REVIEWS':
      return i.reviewCount === 0
        ? 'Henüz değerlendirme yok'
        : `${i.reviewCount} değerlendirme, ortalama ${(i.reviewRatingSum / i.reviewCount).toFixed(2)} (Bayes önseli ${REVIEW_PRIOR_MEAN} × ${REVIEW_PRIOR_WEIGHT})`;
    case 'COMPLETION':
      return `${i.completedJobs} tamamlanan / ${i.completedJobs + i.providerCancelledJobs + i.disputesForCustomer + i.disputesPartial} sonuçlanan iş`;
    case 'CANCELLATION':
      return `${i.providerCancelledJobs} usta iptali / ${i.attributableJobs} iş (müşteri iptalleri hariç)`;
    case 'DISPUTES':
      return `${i.disputesForCustomer} aleyhe, ${i.disputesPartial} kısmi karar / ${i.completedJobs + i.decidedDisputedJobs} iş`;
    case 'RESPONSE':
      return i.responseMedianSeconds === null
        ? 'Yeterli karşı teklif yanıtı yok'
        : `Medyan yanıt ${Math.round(i.responseMedianSeconds / 60)} dk (${i.responseSamples} yanıt)`;
    case 'VERIFICATION':
      return `Kimlik ${i.identityVerified ? 'onaylı' : 'yok'}, mesleki belge ${i.certificateVerified ? 'onaylı' : 'yok'}`;
    case 'EXPERIENCE':
      return `${i.completedJobs} tamamlanan iş, beyan edilen ${i.yearsOfExperience ?? 0} yıl`;
  }
}

export function computeUstaScore(i: QualityInputs, now = new Date()): UstaScoreResult {
  const raw: Record<QualityFactorKey, number | null> = {
    REVIEWS: reviewFactor(i.reviewCount, i.reviewRatingSum),
    COMPLETION: completionFactor(i),
    CANCELLATION: cancellationFactor(i),
    DISPUTES: disputeFactor(i),
    RESPONSE: responseFactor(i.responseMedianSeconds, i.responseSamples),
    VERIFICATION: verificationFactor(i.identityVerified, i.certificateVerified),
    EXPERIENCE: experienceFactor(i.completedJobs, i.yearsOfExperience),
  };
  const keys = Object.keys(WEIGHTS) as QualityFactorKey[];
  const availableWeight = keys.reduce((s, k) => s + (raw[k] === null ? 0 : WEIGHTS[k]), 0);
  const factors: QualityFactor[] = keys.map((key) => {
    const score = raw[key];
    return {
      key,
      weight: WEIGHTS[key],
      effectiveWeight:
        score === null || availableWeight === 0 ? 0 : round2(WEIGHTS[key] / availableWeight),
      score: score === null ? null : round2(score),
      detail: describe(key, i),
    };
  });
  const points = penaltyPoints(i.penalties, now);
  const weighted =
    availableWeight === 0
      ? null
      : keys.reduce((s, k) => s + (raw[k] ?? 0) * WEIGHTS[k], 0) / availableWeight;
  return {
    score: weighted === null ? null : round2(clamp(weighted - points)),
    isNewProvider: i.completedJobs < NEW_PROVIDER_MIN_COMPLETED_JOBS,
    factors,
    penaltyPoints: points,
    sampleSize: i.completedJobs,
  };
}

/**
 * Score used to order eligible providers. New providers get a bounded,
 * neutral exposure score instead of their (thin) computed one, so they are
 * neither buried nor boosted to the top by one good review.
 */
export const NEW_PROVIDER_RANKING_SCORE = 60;

export function rankingScore(snapshot: { score: number; isNewProvider: boolean } | null): number {
  if (!snapshot || snapshot.isNewProvider) return NEW_PROVIDER_RANKING_SCORE;
  return snapshot.score;
}

/** What the public profile may show: an integer, and only for established providers. */
export function publicUstaScore(
  snapshot: { score: number; isNewProvider: boolean; algorithmVersion: string } | null,
): number | null {
  if (!snapshot || snapshot.isNewProvider || snapshot.algorithmVersion !== USTA_SCORE_VERSION) {
    return null;
  }
  return Math.round(snapshot.score);
}
