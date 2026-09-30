import type {
  AdminDispatchTimeline,
  AdminMatchPreview,
  AdminReportedConversation,
  CategoryStats,
  MarketplaceEventName,
  MarketplaceOverview,
  NoOfferRequestRow,
  RegionStats,
} from '@ustago/types';
import {
  adminMessageReportSchema,
  categoryRefLiteSchema,
  chatMessageSchema,
} from '@ustago/validation';
import { z } from 'zod';

/**
 * Response schemas for the Faz 7 admin marketplace, analytics and message
 * report endpoints (docs/faz7/API-CONTRACT.md). The shared package ships
 * only their request schemas; `satisfies` keeps these in step with the
 * shared types.
 */

const date = z.iso.datetime();
const provinceRef = z.object({ id: z.number().int(), name: z.string() });
const districtRef = z.object({ id: z.string(), name: z.string() });
const launchStatus = z.enum(['ACTIVE', 'WAITLIST', 'DISABLED']);

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
  launchStatus,
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
  publishedAt: date.nullable(),
  ageMinutes: z.number().int(),
}) satisfies z.ZodType<NoOfferRequestRow>;

const breakdownLine = z.object({ key: z.string(), label: z.string(), points: z.number() });

export const adminDispatchTimelineSchema = z.object({
  requestId: z.uuid(),
  wave: z.number().int(),
  nextDispatchAt: date.nullable(),
  rows: z.array(
    z.object({
      providerId: z.uuid(),
      providerName: z.string(),
      wave: z.number().int(),
      algorithmVersion: z.string(),
      matchScore: z.number(),
      breakdown: z.array(breakdownLine),
      distanceKm: z.number().nullable(),
      isPreferred: z.boolean(),
      notifyMode: z.enum(['PUSH', 'IN_APP', 'NONE']),
      dispatchedAt: date,
      viewedAt: date.nullable(),
      respondedAt: date.nullable(),
      result: z.enum(['PENDING', 'QUOTED', 'CLOSED']),
    }),
  ),
  events: z.array(
    z.object({
      type: marketplaceEventNameSchema,
      occurredAt: date,
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
      breakdown: z.array(breakdownLine),
      distanceKm: z.number().nullable(),
      alreadyDispatched: z.boolean(),
    }),
  ),
  durationMs: z.number(),
}) satisfies z.ZodType<AdminMatchPreview>;

export const categoryAliasSchema = z.object({ id: z.uuid(), alias: z.string() });

export const adminReportedConversationSchema = z.object({
  report: adminMessageReportSchema,
  messages: z.array(chatMessageSchema.extend({ senderName: z.string().nullable() })),
}) satisfies z.ZodType<AdminReportedConversation>;
