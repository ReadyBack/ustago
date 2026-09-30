import type { ProviderVerificationStatus, RiskSignalType } from '@ustago/types';
import { riskSignalTypeSchema, uuidSchema } from '@ustago/validation';
import { z } from 'zod';

import { istanbulDayStart } from './job-filters';
import { VERIFICATION_CASE_FILTERS } from './labels';

type SearchParams = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) =>
  typeof value === 'string' && value !== '' ? value : undefined;
const daySchema = z.iso.date();

function pick<T>(schema: z.ZodType<T>, raw: string | undefined): T | undefined {
  if (raw === undefined) return undefined;
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

// ---------------------------------------------------------------------------
// Doğrulama talepleri
// ---------------------------------------------------------------------------

export type VerificationCaseFilter = (typeof VERIFICATION_CASE_FILTERS)[number];

export interface VerificationCaseQuery {
  status: VerificationCaseFilter;
  cursor?: string;
}

const caseStatusSchema = z.enum(VERIFICATION_CASE_FILTERS);

/** Unknown statuses fall back to the API default, SUBMITTED (the review queue). */
export function parseVerificationCaseQuery(params: SearchParams): VerificationCaseQuery {
  return {
    status: pick(caseStatusSchema, one(params['status'])) ?? 'SUBMITTED',
    cursor: pick(uuidSchema, one(params['cursor'])),
  };
}

export function verificationCaseQueryString(
  query: VerificationCaseQuery,
  options: { cursor?: string | null; api?: boolean } = {},
): string {
  const search = new URLSearchParams({ status: query.status });
  const cursor = options.cursor === undefined ? query.cursor : options.cursor;
  if (cursor) search.set('cursor', cursor);
  if (options.api) search.set('limit', '25');
  return search.toString();
}

/** Only these cases can still get an admin decision. */
export function isOpenCase(status: ProviderVerificationStatus): boolean {
  return status === 'SUBMITTED' || status === 'UNDER_REVIEW';
}

// ---------------------------------------------------------------------------
// Usta 360 tabs
// ---------------------------------------------------------------------------

export const PROVIDER_360_TABS = [
  { key: 'overview', label: 'Genel' },
  { key: 'verification', label: 'Doğrulama' },
  { key: 'jobs', label: 'İşler' },
  { key: 'reviews', label: 'Yorumlar' },
  { key: 'quality', label: 'Kalite' },
  { key: 'finance', label: 'Finans' },
  { key: 'sanctions', label: 'Cezalar' },
  { key: 'audit', label: 'Denetim' },
] as const;

export type Provider360Tab = (typeof PROVIDER_360_TABS)[number]['key'];

export function parseProvider360Tab(params: SearchParams): Provider360Tab {
  const raw = one(params['tab']);
  return PROVIDER_360_TABS.find((t) => t.key === raw)?.key ?? 'overview';
}

// ---------------------------------------------------------------------------
// Denetim kayıtları
// ---------------------------------------------------------------------------

export interface AuditFilters {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  action?: string;
  /** yyyy-mm-dd, Europe/Istanbul. */
  from?: string;
  to?: string;
  cursor?: string;
}

const entityTypeSchema = z
  .string()
  .trim()
  .regex(/^[a-z_]{1,60}$/);
const entityIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,64}$/);
/** Exact action ("provider.approved") or a prefix ending in "." ("provider."). */
const actionSchema = z
  .string()
  .trim()
  .max(60)
  .regex(/^[a-z_]+(\.[a-z_]*)*$/);

/** Invalid values are dropped (the page shows everything), never sent to the API. */
export function parseAuditFilters(params: SearchParams): AuditFilters {
  const filters: AuditFilters = {
    entityType: pick(entityTypeSchema, one(params['entityType'])),
    entityId: pick(entityIdSchema, one(params['entityId'])),
    actorId: pick(uuidSchema, one(params['actorId'])),
    action: pick(actionSchema, one(params['action'])),
    from: pick(daySchema, one(params['from'])),
    to: pick(daySchema, one(params['to'])),
    cursor: pick(uuidSchema, one(params['cursor'])),
  };
  // A reversed range is refused by the API; show everything instead of an error.
  if (filters.from && filters.to && filters.from > filters.to) {
    filters.from = undefined;
    filters.to = undefined;
  }
  return filters;
}

const AUDIT_KEYS = ['entityType', 'entityId', 'actorId', 'action', 'from', 'to'] as const;

/** The page's own query string (dates as typed; cursor only when given in `extra`). */
export function auditFiltersToQuery(
  filters: AuditFilters,
  extra: Record<string, string> = {},
): string {
  const query = new URLSearchParams();
  for (const key of AUDIT_KEYS) {
    const value = filters[key];
    if (value) query.set(key, value);
  }
  for (const [key, value] of Object.entries(extra)) query.set(key, value);
  return query.toString();
}

/** The API query: days become Istanbul instants; "to" covers the whole day. */
export function auditFiltersToApiQuery(filters: AuditFilters): string {
  const query = new URLSearchParams(
    auditFiltersToQuery({ ...filters, from: undefined, to: undefined }),
  );
  if (filters.from) query.set('from', istanbulDayStart(filters.from));
  // The API range is inclusive, so "to" ends one millisecond before the next day.
  if (filters.to) {
    const end = Date.parse(istanbulDayStart(filters.to, 1)) - 1;
    query.set('to', new Date(end).toISOString());
  }
  if (filters.cursor) query.set('cursor', filters.cursor);
  query.set('limit', '50');
  return query.toString();
}

// ---------------------------------------------------------------------------
// Uyarılar ve risk sinyalleri
// ---------------------------------------------------------------------------

export const ALERT_STATUS_FILTERS = ['ACTIVE', 'OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const;
export const ALERT_SEVERITY_FILTERS = ['CRITICAL', 'WARNING', 'INFO'] as const;

export interface AlertFilters {
  status: (typeof ALERT_STATUS_FILTERS)[number];
  severity?: (typeof ALERT_SEVERITY_FILTERS)[number];
  cursor?: string;
}

export function parseAlertFilters(params: SearchParams): AlertFilters {
  return {
    status: pick(z.enum(ALERT_STATUS_FILTERS), one(params['status'])) ?? 'ACTIVE',
    severity: pick(z.enum(ALERT_SEVERITY_FILTERS), one(params['severity'])),
    cursor: pick(uuidSchema, one(params['cursor'])),
  };
}

export const RISK_STATUS_FILTERS = ['OPEN', 'REVIEWED', 'DISMISSED'] as const;

export interface RiskFilters {
  status: (typeof RISK_STATUS_FILTERS)[number];
  type?: RiskSignalType;
  cursor?: string;
}

export function parseRiskFilters(params: SearchParams): RiskFilters {
  return {
    status: pick(z.enum(RISK_STATUS_FILTERS), one(params['status'])) ?? 'OPEN',
    type: pick(riskSignalTypeSchema, one(params['type'])),
    cursor: pick(uuidSchema, one(params['cursor'])),
  };
}

/**
 * Query string for a filtered list: every set value in order; `cursor`
 * overrides the filter's own (null drops it); `api` adds the page size.
 */
export function filterQuery(
  filters: Record<string, string | undefined>,
  options: { cursor?: string | null; api?: boolean } = {},
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (key !== 'cursor' && value) query.set(key, value);
  }
  const cursor = options.cursor === undefined ? filters['cursor'] : options.cursor;
  if (cursor) query.set('cursor', cursor);
  if (options.api) query.set('limit', '25');
  return query.toString();
}

// ---------------------------------------------------------------------------
// Komisyon politikaları
// ---------------------------------------------------------------------------

/** Max rate the API accepts: 5000 bps = %50. */
export const MAX_FEE_BPS = 5000;

/**
 * A commission rate typed as a percentage ("10", "12,5", "%7.25") as basis
 * points, or null. Parsed as text (no float drift); at most two decimals.
 */
export function parsePercentToBps(text: string): number | null {
  const match = /^%?\s*(\d{1,2})(?:[.,](\d{1,2}))?\s*%?$/.exec(text.trim());
  if (!match) return null;
  const whole = Number(match[1]);
  const frac = Number((match[2] ?? '').padEnd(2, '0'));
  const bps = whole * 100 + frac;
  return bps <= MAX_FEE_BPS ? bps : null;
}

/**
 * The preview table's rate: `?bps=` (links) or `?rate=` (the percentage
 * typed in the preview form), or null when missing / out of range.
 */
export function parsePreviewBps(params: SearchParams): number | null {
  const bps = pick(z.coerce.number().int().min(0).max(MAX_FEE_BPS), one(params['bps']));
  if (bps !== undefined) return bps;
  const rate = one(params['rate']);
  return rate === undefined ? null : parsePercentToBps(rate);
}

/**
 * A `datetime-local` value ("2026-10-01T00:00") read as Istanbul time
 * (UTC+3, no DST) and returned as an ISO instant, or null.
 */
export function istanbulLocalToIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  // Reject impossible values instead of letting Date roll them over (2026-02-31).
  const day = new Date(Date.UTC(y, mo - 1, d));
  if (day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d || h > 23 || mi > 59) return null;
  return new Date(Date.UTC(y, mo - 1, d, h - 3, mi)).toISOString();
}
