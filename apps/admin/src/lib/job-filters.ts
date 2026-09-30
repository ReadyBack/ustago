import type { JobStatus } from '@ustago/types';
import { jobStatusSchema, uuidSchema } from '@ustago/validation';
import { z } from 'zod';

export interface JobFilters {
  status?: JobStatus;
  provinceId?: number;
  categoryId?: string;
  providerId?: string;
  /** The customer's user id. */
  customerId?: string;
  /** yyyy-mm-dd, Europe/Istanbul. */
  from?: string;
  to?: string;
  cursor?: string;
}

type SearchParams = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) =>
  typeof value === 'string' && value !== '' ? value : undefined;
const provinceIdSchema = z.coerce.number().int().min(1).max(81);
const daySchema = z.iso.date();

/** Invalid values are dropped (the page shows everything), never sent to the API. */
export function parseJobFilters(params: SearchParams): JobFilters {
  const pick = <T>(schema: z.ZodType<T>, raw: string | undefined): T | undefined => {
    if (raw === undefined) return undefined;
    const parsed = schema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  };
  return {
    status: pick(jobStatusSchema, one(params['status'])),
    provinceId: pick(provinceIdSchema, one(params['provinceId'])),
    categoryId: pick(uuidSchema, one(params['categoryId'])),
    providerId: pick(uuidSchema, one(params['providerId'])),
    customerId: pick(uuidSchema, one(params['customerId'])),
    from: pick(daySchema, one(params['from'])),
    to: pick(daySchema, one(params['to'])),
    cursor: pick(uuidSchema, one(params['cursor'])),
  };
}

/** Start of a Turkish calendar day (UTC+3, no DST) as an ISO instant. */
export function istanbulDayStart(day: string, addDays = 0): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + addDays, -3)).toISOString();
}

/** The page's own query string (dates as typed). */
export function jobFiltersToQuery(filters: JobFilters, extra: Record<string, string> = {}) {
  const query = new URLSearchParams();
  for (const key of ['status', 'categoryId', 'providerId', 'customerId', 'from', 'to'] as const) {
    const value = filters[key];
    if (value) query.set(key, value);
  }
  if (filters.provinceId) query.set('provinceId', String(filters.provinceId));
  for (const [key, value] of Object.entries(extra)) query.set(key, value);
  return query.toString();
}

/** The API query: days become instants; "to" includes the whole day. */
export function jobFiltersToApiQuery(filters: JobFilters): string {
  const query = new URLSearchParams(
    jobFiltersToQuery({ ...filters, from: undefined, to: undefined }),
  );
  if (filters.from) query.set('from', istanbulDayStart(filters.from));
  if (filters.to) query.set('to', istanbulDayStart(filters.to, 1));
  if (filters.cursor) query.set('cursor', filters.cursor);
  query.set('limit', '25');
  return query.toString();
}
