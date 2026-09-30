import type {
  AdminDispatchTimeline,
  AdminMatchPreview,
  CategoryStats,
  MarketplaceEventName,
  MarketplaceOverview,
  NoOfferRequestRow,
  RegionStats,
} from '@ustago/types';
import { z } from 'zod';

import { categoryRefLiteSchema } from './discovery.js';

/** Faz 7 admin marketplace analytics queries (docs/adr/0028). */

export const marketplaceOverviewQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});
export type MarketplaceOverviewQuery = z.infer<typeof marketplaceOverviewQuerySchema>;

export const regionStatsQuerySchema = z.object({
  /** Without it: one row per province; with it: one row per district. */
  provinceId: z.coerce.number().int().min(1).max(81).optional(),
  days: z.coerce.number().int().min(1).max(90).default(30),
});
export type RegionStatsQuery = z.infer<typeof regionStatsQuerySchema>;

export const categoryStatsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});
export type CategoryStatsQuery = z.infer<typeof categoryStatsQuerySchema>;

export const noOfferQuerySchema = z.object({
  /** Minutes since publication without any quote. */
  olderThanMinutes: z.coerce
    .number()
    .int()
    .min(0)
    .max(60 * 24 * 30)
    .default(60),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});
export type NoOfferQuery = z.infer<typeof noOfferQuerySchema>;

export const matchPreviewQuerySchema = z.object({ requestId: z.uuid() });
export type MatchPreviewQuery = z.infer<typeof matchPreviewQuerySchema>;

/** Counts below this are hidden ("<5") in region analytics (small-sample privacy). */
export const REGION_PRIVACY_THRESHOLD = 5;

// ---------------------------------------------------------------------------
// Response schemas (API contract tests and OpenAPI). Mirrors the admin app's
// own copies in apps/admin/src/lib/marketplace-schemas.ts.
// ---------------------------------------------------------------------------

const isoDate = z.iso.datetime();
const provinceRef = z.object({ id: z.number().int(), name: z.string() });
const districtRef = z.object({ id: z.string(), name: z.string() });

export const marketplaceEventNameSchema = z.enum([
  'request_created',
  'request_dispatched',
  'provider_viewed_request',
  'quote_created',
  'quote_accepted',
  'job_started',
  'job_completed',
  'conversation_started',
  'message_sent',
  'provider_favorited',
  'provider_rehired',
  'search_performed',
  'search_no_result',
  'search_category_clicked',
  'request_no_offer',
  'request_search_expanded',
]) satisfies z.ZodType<MarketplaceEventName>;

export const marketplaceOverviewSchema = z.object({
  periodDays: z.number().int(),
  timeZone: z.string(),
  today: z.object({
    requestsCreated: z.number().int(),
    quotes: z.number().int(),
    jobsCompleted: z.number().int(),
  }),
  quoteRatePercent: z.number().nullable(),
  acceptanceRatePercent: z.number().nullable(),
  completionRatePercent: z.number().nullable(),
  medianFirstQuoteMinutes: z.number().nullable(),
  noOfferOpenRequests: z.number().int(),
  activeProviders: z.number().int(),
  availableProviders: z.number().int(),
  funnel: z.array(
    z.object({
      key: z.enum([
        'created',
        'dispatched',
        'viewed',
        'quoted',
        'accepted',
        'started',
        'completed',
      ]),
      label: z.string(),
      requests: z.number().int(),
    }),
  ),
  search: z.object({
    searches: z.number().int(),
    noResult: z.number().int(),
    topNoResultQueries: z.array(z.object({ query: z.string(), count: z.number().int() })),
  }),
}) satisfies z.ZodType<MarketplaceOverview>;

export const regionStatsSchema = z.object({
  province: provinceRef,
  district: districtRef.nullable(),
  requests: z.number().int().nullable(),
  quotes: z.number().int().nullable(),
  completedJobs: z.number().int().nullable(),
  activeProviders: z.number().int(),
  availableProviders: z.number().int(),
  demandPerProvider: z.number().nullable(),
  unservedRequests: z.number().int().nullable(),
  launchStatus: z.enum(['ACTIVE', 'WAITLIST', 'DISABLED']),
}) satisfies z.ZodType<RegionStats>;

export const categoryStatsSchema = z.object({
  category: categoryRefLiteSchema,
  requests: z.number().int(),
  quotes: z.number().int(),
  acceptanceRatePercent: z.number().nullable(),
  completionRatePercent: z.number().nullable(),
  medianPriceMinor: z.number().int().nullable(),
  activeProviders: z.number().int(),
}) satisfies z.ZodType<CategoryStats>;

export const noOfferRequestRowSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  category: categoryRefLiteSchema,
  province: provinceRef,
  district: districtRef,
  wave: z.number().int(),
  dispatchedCount: z.number().int(),
  publishedAt: isoDate.nullable(),
  ageMinutes: z.number().int(),
}) satisfies z.ZodType<NoOfferRequestRow>;

const matchBreakdownLineSchema = z.object({
  key: z.string(),
  label: z.string(),
  points: z.number(),
});

export const adminDispatchTimelineSchema = z.object({
  requestId: z.uuid(),
  wave: z.number().int(),
  nextDispatchAt: isoDate.nullable(),
  rows: z.array(
    z.object({
      providerId: z.uuid(),
      providerName: z.string(),
      wave: z.number().int(),
      algorithmVersion: z.string(),
      matchScore: z.number(),
      breakdown: z.array(matchBreakdownLineSchema),
      distanceKm: z.number().nullable(),
      isPreferred: z.boolean(),
      notifyMode: z.enum(['PUSH', 'IN_APP', 'NONE']),
      dispatchedAt: isoDate,
      viewedAt: isoDate.nullable(),
      respondedAt: isoDate.nullable(),
      result: z.enum(['PENDING', 'QUOTED', 'CLOSED']),
    }),
  ),
  events: z.array(
    z.object({
      type: marketplaceEventNameSchema,
      occurredAt: isoDate,
      providerId: z.uuid().nullable(),
      value: z.number().nullable(),
    }),
  ),
}) satisfies z.ZodType<AdminDispatchTimeline>;

export const adminMatchPreviewSchema = z.object({
  requestId: z.uuid(),
  algorithmVersion: z.string(),
  candidates: z.array(
    z.object({
      providerId: z.uuid(),
      providerName: z.string(),
      score: z.number(),
      breakdown: z.array(matchBreakdownLineSchema),
      distanceKm: z.number().nullable(),
      alreadyDispatched: z.boolean(),
    }),
  ),
  durationMs: z.number(),
}) satisfies z.ZodType<AdminMatchPreview>;
