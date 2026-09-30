import type { FunnelStep, Province, RegionStats } from '@ustago/types';
import {
  formatMoney,
  REGION_PRIVACY_THRESHOLD,
  type UpdateProvinceRequest,
} from '@ustago/validation';

/**
 * Pure helpers for the Faz 7 marketplace screens. Nothing here invents a
 * number: missing values (null) are shown as "—", "<5" or "Yetersiz veri",
 * exactly as the API contract describes.
 */

export const PERIOD_OPTIONS = [7, 30, 90] as const;
export type PeriodDays = (typeof PERIOD_OPTIONS)[number];

/** `?days=` from the URL; anything but 7, 30 or 90 falls back to the default. */
export function parsePeriod(raw: unknown, fallback: PeriodDays): PeriodDays {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = typeof value === 'string' ? Number(value) : NaN;
  return (PERIOD_OPTIONS as readonly number[]).includes(n) ? (n as PeriodDays) : fallback;
}

/** `?provinceId=` (plate code 1–81), or undefined. */
export function parseProvinceId(raw: unknown): number | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !/^\d{1,2}$/.test(value)) return undefined;
  const n = Number(value);
  return n >= 1 && n <= 81 ? n : undefined;
}

/** "Teklifsiz talepler" age filter: minutes since publication without a quote. */
export const NO_OFFER_AGE_OPTIONS = [30, 60, 120, 240, 1440] as const;

export function parseOlderThan(raw: unknown): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = typeof value === 'string' ? Number(value) : NaN;
  return (NO_OFFER_AGE_OPTIONS as readonly number[]).includes(n) ? n : 60;
}

/** An opaque pagination cursor from the URL, or undefined. */
export function parseCursor(raw: unknown): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && /^[A-Za-z0-9_\-:.=]{1,200}$/.test(value) ? value : undefined;
}

const percentFormat = new Intl.NumberFormat('tr-TR', {
  style: 'percent',
  maximumFractionDigits: 1,
});
const decimalFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const integerFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });

/** A 0–100 percentage from the API; null (denominator 0) → "—". */
export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : percentFormat.format(value / 100);
}

export function formatCount(value: number): string {
  return integerFormat.format(value);
}

/** Region counts below the privacy threshold arrive as null and read "<5". */
export function formatPrivateCount(value: number | null): string {
  return value === null ? `<${REGION_PRIVACY_THRESHOLD}` : integerFormat.format(value);
}

/** Demand per available provider; null (no available provider) → "—". */
export function formatRatio(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '—' : decimalFormat.format(value);
}

/** Minutes as "45 dk", "3 sa 10 dk" or "2 gün 4 sa"; null → "—". */
export function formatMinutes(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes) || minutes < 0) return '—';
  const total = Math.round(minutes);
  if (total < 60) return `${total} dk`;
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  if (days > 0) return hours > 0 ? `${days} gün ${hours} sa` : `${days} gün`;
  return mins > 0 ? `${hours} sa ${mins} dk` : `${hours} sa`;
}

/** Approximate distance: "≈ 3,4 km"; unknown → "—". */
export function formatDistanceKm(km: number | null): string {
  return km === null || !Number.isFinite(km) ? '—' : `≈ ${decimalFormat.format(km)} km`;
}

/** Median agreed price in kuruş; null (below the sample threshold) → "Yetersiz veri". */
export function formatMedianPrice(minor: number | null): string {
  return minor === null ? 'Yetersiz veri' : formatMoney(minor);
}

export interface FunnelRow extends FunnelStep {
  /** Share of the previous step (null for the first step or when it was 0). */
  fromPreviousPercent: number | null;
  /** Share of the first step (null when the first step was 0). */
  ofFirstPercent: number | null;
  /** Bar width 0–100, relative to the largest step. */
  barPercent: number;
}

function share(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

/** Step-to-step conversion for the funnel bars, from the API's own counts. */
export function funnelRows(steps: readonly FunnelStep[]): FunnelRow[] {
  const first = steps[0]?.requests ?? 0;
  const max = steps.reduce((m, s) => Math.max(m, s.requests), 0);
  return steps.map((step, i) => {
    const prev = i === 0 ? undefined : steps[i - 1];
    return {
      ...step,
      fromPreviousPercent: prev ? share(step.requests, prev.requests) : null,
      ofFirstPercent: share(step.requests, first),
      barPercent: max > 0 ? Math.round((step.requests / max) * 1000) / 10 : 0,
    };
  });
}

export type LaunchStatus = Province['launchStatus'];
export const LAUNCH_STATUSES: readonly LaunchStatus[] = ['ACTIVE', 'WAITLIST', 'DISABLED'];

/**
 * The PATCH /locations/provinces/:id body for a launch status: ACTIVE =
 * open; WAITLIST = closed but customers may post requests that wait for
 * supply; DISABLED = closed.
 */
export function launchStatusPayload(status: LaunchStatus): Required<UpdateProvinceRequest> {
  switch (status) {
    case 'ACTIVE':
      return { isActive: true, waitlistOpen: false };
    case 'WAITLIST':
      return { isActive: false, waitlistOpen: true };
    case 'DISABLED':
      return { isActive: false, waitlistOpen: false };
  }
}

export function isLaunchStatus(value: unknown): value is LaunchStatus {
  return typeof value === 'string' && (LAUNCH_STATUSES as readonly string[]).includes(value);
}

/** Region row label: district name in a province drill-down, else the province. */
export function regionName(row: Pick<RegionStats, 'province' | 'district'>): string {
  return row.district ? row.district.name : row.province.name;
}
