import type { MatchBreakdownLine } from '@ustago/types';

import { rankingScore } from '../../quality/domain/usta-score.js';

/**
 * MATCH_V1 (docs/adr/0028): orders providers who are ALREADY eligible for a
 * request (eligibility decides who may take it at all; this score only
 * decides who hears first). Deterministic and explainable: every point is
 * a named line in the breakdown stored with the dispatch.
 *
 * Rules that keep it honest:
 * - Verification is a small, separate line ("Kimlik doğrulandı"), never a
 *   quality claim; quality comes from UstaScore, which is Bayesian and
 *   needs completed jobs.
 * - New providers get the neutral UstaScore plus a bounded cold-start
 *   bonus, so they are neither buried nor pushed above proven providers.
 * - Response data counts only above a minimum sample; below it the line
 *   is neutral, never zero and never invented.
 * - Activity is capped: opening the app often cannot outrank quality.
 */
export const MATCH_ALGORITHM_VERSION = 'MATCH_V1';

export interface MatchSignals {
  providerId: string;
  /** DISTRICT = explicit district; REGION = whole province or radius. */
  areaFit: 'DISTRICT' | 'REGION';
  distanceKm: number | null;
  /** From the shared availability evaluation (docs/adr/0031). */
  workingNow: boolean;
  ustaScore: { score: number; isNewProvider: boolean } | null;
  response: { dispatched: number; responded: number; medianMinutes: number | null } | null;
  completedJobs: number;
  /** Last 90 days. */
  providerCancelledJobs: number;
  attributableJobs: number;
  lastActiveAt: Date | null;
  approvedAt: Date | null;
  verified: boolean;
  accountLimited: boolean;
  visibilityReduced: boolean;
  activeWarnings: number;
}

export interface MatchConfig {
  now: Date;
  coldStartDays: number;
  responseMinSample: number;
  /** Beyond this the distance line is 0 (km). */
  distanceHorizonKm: number;
}

export interface MatchScore {
  providerId: string;
  score: number;
  breakdown: MatchBreakdownLine[];
  distanceKm: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const DAY = 86_400_000;

export const MATCH_POINTS = {
  AREA_DISTRICT: 10,
  AREA_REGION: 6,
  DISTANCE_MAX: 20,
  DISTANCE_UNKNOWN: 8,
  WORKING_NOW: 10,
  OUTSIDE_HOURS: 4,
  QUALITY_MAX: 30,
  RESPONSE_MAX: 10,
  RESPONSE_NEUTRAL: 5,
  ACTIVE_7D: 5,
  ACTIVE_30D: 2,
  VERIFIED: 5,
  COLD_START: 5,
  CANCELLATION_MAX_PENALTY: 10,
  LIMITED_PENALTY: 10,
  VISIBILITY_PENALTY: 15,
  WARNING_PENALTY: 3,
  WARNING_MAX_PENALTY: 6,
} as const;

export function scoreProvider(s: MatchSignals, cfg: MatchConfig): MatchScore {
  const P = MATCH_POINTS;
  const lines: MatchBreakdownLine[] = [];
  const add = (key: string, label: string, points: number) => {
    if (points !== 0) lines.push({ key, label, points: round1(points) });
  };

  add(
    'area',
    s.areaFit === 'DISTRICT' ? 'Hizmet verdiği ilçe' : 'Hizmet bölgesi (il / yarıçap)',
    s.areaFit === 'DISTRICT' ? P.AREA_DISTRICT : P.AREA_REGION,
  );

  if (s.distanceKm === null) {
    add('distance', 'Mesafe bilinmiyor (nötr)', P.DISTANCE_UNKNOWN);
  } else {
    const ratio = Math.max(0, 1 - s.distanceKm / cfg.distanceHorizonKm);
    add('distance', `Yaklaşık ${Math.round(s.distanceKm)} km`, P.DISTANCE_MAX * ratio);
  }

  add(
    'availability',
    s.workingNow ? 'Şu an çalışma saatinde' : 'Çalışma saati dışında',
    s.workingNow ? P.WORKING_NOW : P.OUTSIDE_HOURS,
  );

  const quality = rankingScore(s.ustaScore);
  const isNew = !s.ustaScore || s.ustaScore.isNewProvider;
  add(
    'quality',
    isNew ? 'Yeni usta: nötr UstaScore' : `UstaScore ${Math.round(quality)}`,
    (P.QUALITY_MAX * quality) / 100,
  );

  const r = s.response;
  if (!r || r.dispatched < cfg.responseMinSample || r.medianMinutes === null) {
    add('response', 'Yanıt verisi yetersiz (nötr)', P.RESPONSE_NEUTRAL);
  } else {
    const rate = r.responded / r.dispatched;
    const m = r.medianMinutes;
    const speed = m <= 15 ? 4 : m <= 60 ? 3 : m <= 180 ? 2 : 1;
    add('response', `Yanıt oranı %${Math.round(rate * 100)}, medyan ${Math.round(m)} dk`, rate * 6 + speed);
  }

  if (s.lastActiveAt) {
    const age = cfg.now.getTime() - s.lastActiveAt.getTime();
    if (age <= 7 * DAY) add('activity', 'Son 7 günde aktif', P.ACTIVE_7D);
    else if (age <= 30 * DAY) add('activity', 'Son 30 günde aktif', P.ACTIVE_30D);
  }

  if (s.verified) add('verification', 'Kimlik doğrulandı (kalite puanı değildir)', P.VERIFIED);

  if (
    isNew &&
    s.approvedAt &&
    cfg.now.getTime() - s.approvedAt.getTime() <= cfg.coldStartDays * DAY
  ) {
    add('cold_start', 'Yeni usta tanıtım payı', P.COLD_START);
  }

  if (s.attributableJobs >= 3 && s.providerCancelledJobs > 0) {
    const rate = s.providerCancelledJobs / s.attributableJobs;
    add(
      'cancellations',
      `Son 90 günde usta iptali %${Math.round(rate * 100)}`,
      -Math.min(P.CANCELLATION_MAX_PENALTY, rate * 20),
    );
  }
  if (s.accountLimited) add('account', 'Hesap kısıtlı', -P.LIMITED_PENALTY);
  if (s.visibilityReduced) add('penalty', 'Görünürlük azaltma yaptırımı', -P.VISIBILITY_PENALTY);
  if (s.activeWarnings > 0) {
    add(
      'warnings',
      `${s.activeWarnings} aktif uyarı`,
      -Math.min(P.WARNING_MAX_PENALTY, s.activeWarnings * P.WARNING_PENALTY),
    );
  }

  const total = lines.reduce((sum, l) => sum + l.points, 0);
  return {
    providerId: s.providerId,
    score: round1(Math.min(100, Math.max(0, total))),
    breakdown: lines,
    distanceKm: s.distanceKm === null ? null : round1(s.distanceKm),
  };
}

/** Deterministic order: score desc, then nearer, then provider id. */
export function compareScores(a: MatchScore, b: MatchScore): number {
  if (b.score !== a.score) return b.score - a.score;
  const da = a.distanceKm ?? Number.POSITIVE_INFINITY;
  const db = b.distanceKm ?? Number.POSITIVE_INFINITY;
  if (da !== db) return da - db;
  return a.providerId < b.providerId ? -1 : a.providerId > b.providerId ? 1 : 0;
}

export function rankProviders(signals: readonly MatchSignals[], cfg: MatchConfig): MatchScore[] {
  return signals.map((s) => scoreProvider(s, cfg)).sort(compareScores);
}
