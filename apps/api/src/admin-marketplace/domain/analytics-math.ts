import type { FunnelStep, RegionStats } from '@ustago/types';
import { REGION_PRIVACY_THRESHOLD } from '@ustago/validation';

/**
 * Pure helpers for the Faz 7 admin marketplace analytics (docs/adr/0028).
 * Nothing here invents a number: a rate without a denominator is null, and
 * region counts below the privacy threshold are withheld (null, shown "<5").
 */

/** part / whole as a 0–100 percentage with one decimal; null when whole is 0. */
export function percent(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

/** A median from SQL (float or null) rounded to one decimal. */
export function roundMedian(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

export interface FunnelCounts {
  created: number;
  dispatched: number;
  viewed: number;
  quoted: number;
  accepted: number;
  started: number;
  completed: number;
}

export const FUNNEL_LABELS: Record<FunnelStep['key'], string> = {
  created: 'Talep oluşturuldu',
  dispatched: 'Ustalara gönderildi',
  viewed: 'Usta görüntüledi',
  quoted: 'Teklif geldi',
  accepted: 'Teklif kabul edildi',
  started: 'İş başladı',
  completed: 'İş tamamlandı',
};

const FUNNEL_ORDER: FunnelStep['key'][] = [
  'created',
  'dispatched',
  'viewed',
  'quoted',
  'accepted',
  'started',
  'completed',
];

/** Funnel steps in order (each count = distinct requests of the cohort that reached the step). */
export function funnelSteps(counts: FunnelCounts): FunnelStep[] {
  return FUNNEL_ORDER.map((key) => ({ key, label: FUNNEL_LABELS[key], requests: counts[key] }));
}

/** Raw per-region numbers straight from SQL, before privacy suppression. */
export interface RawRegionRow {
  province: { id: number; name: string };
  district: { id: string; name: string } | null;
  requests: number;
  quotes: number;
  completedJobs: number;
  unservedRequests: number;
  activeProviders: number;
  availableProviders: number;
  launchStatus: RegionStats['launchStatus'];
}

/** A count below the threshold (but above zero) is withheld. */
export function suppressSmall(n: number, threshold = REGION_PRIVACY_THRESHOLD): number | null {
  return n > 0 && n < threshold ? null : n;
}

/**
 * Small-sample privacy for a region row: when the region has fewer than
 * `threshold` requests, every request-derived number (requests, quotes,
 * completed jobs, unserved requests and demand per provider) is withheld,
 * so a single customer's request in a small district cannot be singled
 * out. Above it, each derived count below the threshold is withheld on
 * its own. Supply counts (providers) are public listings and stay.
 */
export function toRegionStats(
  raw: RawRegionRow,
  threshold = REGION_PRIVACY_THRESHOLD,
): RegionStats {
  const small = raw.requests > 0 && raw.requests < threshold;
  const demandPerProvider =
    small || raw.availableProviders <= 0
      ? null
      : Math.round((raw.requests / raw.availableProviders) * 100) / 100;
  return {
    province: raw.province,
    district: raw.district,
    requests: small ? null : raw.requests,
    quotes: small ? null : suppressSmall(raw.quotes, threshold),
    completedJobs: small ? null : suppressSmall(raw.completedJobs, threshold),
    activeProviders: raw.activeProviders,
    availableProviders: raw.availableProviders,
    demandPerProvider,
    unservedRequests: small ? null : suppressSmall(raw.unservedRequests, threshold),
    launchStatus: raw.launchStatus,
  };
}

/**
 * Region order: visible demand first (largest first), then supply, then
 * name. Withheld rows sort as if they had no demand, so the order itself
 * does not rank small regions against each other.
 */
export function compareRegions(a: RegionStats, b: RegionStats): number {
  const da = a.requests ?? 0;
  const db = b.requests ?? 0;
  if (db !== da) return db - da;
  if (b.activeProviders !== a.activeProviders) return b.activeProviders - a.activeProviders;
  const na = a.district?.name ?? a.province.name;
  const nb = b.district?.name ?? b.province.name;
  return na.localeCompare(nb, 'tr');
}

/** Median price only with enough completed jobs from enough distinct providers. */
export function medianPriceOrNull(
  median: number | null,
  sample: number,
  providers: number,
  minSample: number,
  minProviders: number,
): number | null {
  if (median === null || !Number.isFinite(median)) return null;
  if (sample < minSample || providers < minProviders) return null;
  return Math.round(median);
}

export interface BreakdownLine {
  key: string;
  label: string;
  points: number;
}

/** The MATCH_V1 breakdown stored as JSON on a dispatch row; malformed lines are dropped. */
export function parseBreakdown(json: unknown): BreakdownLine[] {
  if (!Array.isArray(json)) return [];
  const out: BreakdownLine[] = [];
  for (const item of json) {
    if (typeof item !== 'object' || item === null) continue;
    const { key, label, points } = item as Record<string, unknown>;
    if (typeof key !== 'string' || typeof label !== 'string') continue;
    const n = typeof points === 'number' ? points : Number(points);
    if (!Number.isFinite(n)) continue;
    out.push({ key, label, points: n });
  }
  return out;
}
