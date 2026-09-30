import type { ServiceRequestStatus, ServiceRequestType } from '@ustago/types';
import {
  serviceRequestStatusSchema,
  serviceRequestTypeSchema,
  uuidSchema,
} from '@ustago/validation';
import { z } from 'zod';

export interface ServiceRequestFilters {
  status?: ServiceRequestStatus;
  type?: ServiceRequestType;
  provinceId?: number;
  categoryId?: string;
  cursor?: string;
}

type SearchParams = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) =>
  typeof value === 'string' && value !== '' ? value : undefined;
const provinceIdSchema = z.coerce.number().int().min(1).max(81);

/**
 * Reads the list filters from the page URL. Anything invalid is dropped
 * (the page shows everything) rather than turned into an API error.
 */
export function parseServiceRequestFilters(params: SearchParams): ServiceRequestFilters {
  const pick = <T>(schema: z.ZodType<T>, raw: string | undefined): T | undefined => {
    if (raw === undefined) return undefined;
    const parsed = schema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  };
  return {
    status: pick(serviceRequestStatusSchema, one(params['status'])),
    type: pick(serviceRequestTypeSchema, one(params['type'])),
    provinceId: pick(provinceIdSchema, one(params['provinceId'])),
    categoryId: pick(uuidSchema, one(params['categoryId'])),
    cursor: pick(uuidSchema, one(params['cursor'])),
  };
}

/** Query string for the API and for the page's own links (cursor optional). */
export function filtersToQuery(filters: ServiceRequestFilters, extra: Record<string, string> = {}) {
  const query = new URLSearchParams();
  if (filters.status) query.set('status', filters.status);
  if (filters.type) query.set('type', filters.type);
  if (filters.provinceId) query.set('provinceId', String(filters.provinceId));
  if (filters.categoryId) query.set('categoryId', filters.categoryId);
  for (const [key, value] of Object.entries(extra)) query.set(key, value);
  return query.toString();
}
