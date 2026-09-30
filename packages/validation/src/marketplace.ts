import type {
  AdminDashboardStats,
  AdminServiceRequestDetail,
  AdminServiceRequestListItem,
  AdminSystemStatus,
  AppNotification,
  Job,
  JobListItem,
  Opportunity,
  ProviderQuoteListItem,
  Quote,
  QuoteRevision,
  ServiceRequest,
  ServiceRequestListItem,
} from '@ustago/types';
import { z } from 'zod';

import {
  changeOrderSchema,
  jobActionsSchema,
  jobActorSchema,
  jobDisputeSchema,
  jobTimelineEntrySchema,
  reviewSchema,
} from './lifecycle.js';
import { moneySchema, pricePartMinorSchema, priceMinorSchema } from './money.js';

/** Photos per request; enough to show the problem, small enough to review. */
export const MAX_REQUEST_PHOTOS = 5;
export const REQUEST_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png'] as const;
/** Moves in one negotiation (offer + counters); stops endless ping-pong. */
export const MAX_QUOTE_REVISIONS = 10;

export const serviceRequestTypeSchema = z.enum(['NOW', 'QUOTE']);
export const serviceRequestStatusSchema = z.enum([
  'DRAFT',
  'PUBLISHED',
  'MATCHING',
  'QUOTED',
  'MATCHED',
  'CANCELLED',
  'EXPIRED',
  'COMPLETED',
]);
export const quoteStatusSchema = z.enum([
  'PENDING_CUSTOMER',
  'PENDING_PROVIDER',
  'ACCEPTED',
  'REJECTED',
  'WITHDRAWN',
  'EXPIRED',
]);
export const quoteRevisionKindSchema = z.enum(['OFFER', 'CUSTOMER_COUNTER', 'PROVIDER_COUNTER']);
export const jobStatusSchema = z.enum([
  'CREATED',
  'CONFIRMED',
  'PROVIDER_PREPARING',
  'PROVIDER_EN_ROUTE',
  'PROVIDER_ARRIVED',
  'IN_PROGRESS',
  'AWAITING_COMPLETION_CONFIRMATION',
  'COMPLETED',
  'DISPUTED',
  'CANCELLED',
]);

const isoDate = z.iso.datetime({ offset: true });
const optionalNote = (max: number) => z.string().trim().min(1).max(max).nullable().optional();

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

const requestTitle = z.string().trim().min(3, 'Başlık en az 3 karakter olmalı.').max(140);
const requestDescription = z
  .string()
  .trim()
  .min(10, 'Lütfen işi en az 10 karakterle anlatın.')
  .max(4000);

function windowOrdered(value: {
  preferredStartAt?: string | null;
  preferredEndAt?: string | null;
}) {
  if (!value.preferredStartAt || !value.preferredEndAt) return true;
  return new Date(value.preferredEndAt) >= new Date(value.preferredStartAt);
}
const WINDOW_ERROR = {
  path: ['preferredEndAt'],
  message: 'Bitiş zamanı başlangıçtan önce olamaz.',
};

/**
 * POST /service-requests. `budgetMinor: null` means "Bütçem belli değil".
 * The budget is only an estimate: it never limits what providers quote.
 */
export const createServiceRequestSchema = z
  .object({
    type: serviceRequestTypeSchema,
    categoryId: z.uuid(),
    addressId: z.uuid(),
    title: requestTitle,
    description: requestDescription,
    budgetMinor: priceMinorSchema.nullable(),
    preferredStartAt: isoDate.nullable().optional(),
    preferredEndAt: isoDate.nullable().optional(),
    photoUploadIds: z
      .array(z.uuid())
      .max(MAX_REQUEST_PHOTOS)
      .refine((ids) => new Set(ids).size === ids.length, 'Aynı fotoğraf iki kez eklenemez.')
      .default([]),
    /** false keeps the request as a DRAFT; publish later. */
    publish: z.boolean().default(true),
    /** Client-generated; resending the same key returns the first request. */
    idempotencyKey: z.uuid().optional(),
  })
  .strict()
  .refine(windowOrdered, WINDOW_ERROR);
export type CreateServiceRequest = z.infer<typeof createServiceRequestSchema>;

export const updateServiceRequestSchema = z
  .object({
    categoryId: z.uuid().optional(),
    addressId: z.uuid().optional(),
    title: requestTitle.optional(),
    description: requestDescription.optional(),
    budgetMinor: priceMinorSchema.nullable().optional(),
    preferredStartAt: isoDate.nullable().optional(),
    preferredEndAt: isoDate.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'En az bir alan gönderin.' })
  .refine(windowOrdered, WINDOW_ERROR);
export type UpdateServiceRequest = z.infer<typeof updateServiceRequestSchema>;

export const cancelServiceRequestSchema = z
  .object({ reason: z.string().trim().min(3).max(500).optional() })
  .strict();
export type CancelServiceRequest = z.infer<typeof cancelServiceRequestSchema>;

/** Status groups used by the "Taleplerim" tabs. */
export const serviceRequestStatusGroupSchema = z.enum(['OPEN', 'AGREED', 'CLOSED']);

export const listMyServiceRequestsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.uuid().optional(),
  status: serviceRequestStatusSchema.optional(),
  group: serviceRequestStatusGroupSchema.optional(),
});
export type ListMyServiceRequestsQuery = z.infer<typeof listMyServiceRequestsQuerySchema>;

export const createRequestPhotoUploadSchema = z
  .object({
    mimeType: z.enum(REQUEST_PHOTO_MIME_TYPES),
    sizeBytes: z.number().int().min(1),
    fileName: z.string().trim().min(1).max(255).optional(),
  })
  .strict();
export type CreateRequestPhotoUpload = z.infer<typeof createRequestPhotoUploadSchema>;

// ---------------------------------------------------------------------------
// Opportunities and quotes
// ---------------------------------------------------------------------------

export const listOpportunitiesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.uuid().optional(),
  type: serviceRequestTypeSchema.optional(),
  categoryId: z.uuid().optional(),
});
export type ListOpportunitiesQuery = z.infer<typeof listOpportunitiesQuerySchema>;

/**
 * A provider's offer. The total is free: it may be above, below or equal to
 * the customer's budget (docs/adr/0014). When both parts are given they
 * must add up to the total.
 */
export const createQuoteSchema = z
  .object({
    totalMinor: priceMinorSchema,
    laborMinor: pricePartMinorSchema.nullable().optional(),
    materialMinor: pricePartMinorSchema.nullable().optional(),
    materialsIncluded: z.boolean().nullable().optional(),
    note: optionalNote(2000),
    estimatedDurationMinutes: z
      .number()
      .int()
      .min(5)
      .max(60 * 24 * 30)
      .nullable()
      .optional(),
    availableFrom: isoDate.nullable().optional(),
    validUntil: isoDate.nullable().optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.laborMinor === undefined ||
      v.laborMinor === null ||
      v.materialMinor === undefined ||
      v.materialMinor === null ||
      v.laborMinor + v.materialMinor === v.totalMinor,
    { path: ['totalMinor'], message: 'İşçilik ve malzeme toplamı, toplam tutara eşit olmalı.' },
  );
export type CreateQuote = z.infer<typeof createQuoteSchema>;

/**
 * Counter offer. `expectedRevisionNo` is the revision the caller is
 * answering: if the other side moved in the meantime the server answers
 * 409 instead of countering a price the caller never saw.
 */
export const counterQuoteSchema = z
  .object({
    totalMinor: priceMinorSchema,
    note: optionalNote(1000),
    expectedRevisionNo: z.number().int().min(1),
  })
  .strict();
export type CounterQuote = z.infer<typeof counterQuoteSchema>;

export const acceptQuoteSchema = z.object({ expectedRevisionNo: z.number().int().min(1) }).strict();
export type AcceptQuote = z.infer<typeof acceptQuoteSchema>;

export const closeQuoteSchema = z
  .object({ reason: z.string().trim().min(3).max(500).optional() })
  .strict();
export type CloseQuote = z.infer<typeof closeQuoteSchema>;

export const quoteListFilterSchema = z.enum(['WAITING', 'NEGOTIATING', 'ACCEPTED', 'CLOSED']);
export const listProviderQuotesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.uuid().optional(),
  filter: quoteListFilterSchema.optional(),
});
export type ListProviderQuotesQuery = z.infer<typeof listProviderQuotesQuerySchema>;

export const listJobsQuerySchema = z.object({
  role: z.enum(['CUSTOMER', 'PROVIDER']).default('CUSTOMER'),
  /** ACTIVE: agreed and not finished (home screen "Aktif işiniz"). */
  scope: z.enum(['ALL', 'ACTIVE', 'FINISHED']).default('ALL'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.uuid().optional(),
});
export type ListJobsQuery = z.infer<typeof listJobsQuerySchema>;

export const markNotificationsReadSchema = z
  .object({ ids: z.array(z.uuid()).min(1).max(100).optional() })
  .strict();
export type MarkNotificationsRead = z.infer<typeof markNotificationsReadSchema>;

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const adminStatsQuerySchema = z.object({
  /** IANA zone for "today"; defaults to the marketplace's zone. */
  tz: z
    .string()
    .max(64)
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'Geçersiz saat dilimi.')
    .optional(),
});
export type AdminStatsQuery = z.infer<typeof adminStatsQuerySchema>;

export const listAdminServiceRequestsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
  status: serviceRequestStatusSchema.optional(),
  type: serviceRequestTypeSchema.optional(),
  provinceId: z.coerce.number().int().min(1).max(81).optional(),
  categoryId: z.uuid().optional(),
});
export type ListAdminServiceRequestsQuery = z.infer<typeof listAdminServiceRequestsQuerySchema>;

// ---------------------------------------------------------------------------
// Responses (Swagger + client-side parsing)
// ---------------------------------------------------------------------------

const namedRef = z.object({ id: z.uuid(), name: z.string() });
const provinceRef = z.object({ id: z.number().int(), name: z.string() });
export const categoryRefSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
});
export const approximateLocationSchema = z.object({ province: provinceRef, district: namedRef });
export const serviceAddressSchema = approximateLocationSchema.extend({
  addressId: z.uuid(),
  label: z.string().nullable(),
  neighborhood: z.string().nullable(),
  addressLine: z.string(),
  buildingNo: z.string().nullable(),
  apartmentNo: z.string().nullable(),
  postalCode: z.string().nullable(),
  instructions: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
});
const photoSchema = z.object({ id: z.uuid(), mimeType: z.string(), sizeBytes: z.number().int() });
const jobSummarySchema = z.object({
  id: z.uuid(),
  status: jobStatusSchema,
  agreedPrice: moneySchema,
  provider: namedRef.pick({ id: true }).extend({ displayName: z.string() }),
  createdAt: z.iso.datetime(),
});
const nullableDate = z.iso.datetime().nullable();

export const serviceRequestSchema = z.object({
  id: z.uuid(),
  type: serviceRequestTypeSchema,
  status: serviceRequestStatusSchema,
  title: z.string(),
  description: z.string(),
  category: categoryRefSchema,
  address: serviceAddressSchema,
  budget: moneySchema.nullable(),
  preferredStartAt: nullableDate,
  preferredEndAt: nullableDate,
  publishedAt: nullableDate,
  expiresAt: nullableDate,
  cancelledAt: nullableDate,
  cancelReason: z.string().nullable(),
  photos: z.array(photoSchema),
  openQuoteCount: z.number().int(),
  quoteCount: z.number().int(),
  job: jobSummarySchema.nullable(),
  actions: z.object({
    edit: z.boolean(),
    editCriticalFields: z.boolean(),
    publish: z.boolean(),
    cancel: z.boolean(),
  }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}) satisfies z.ZodType<ServiceRequest>;

export const serviceRequestListItemSchema = z.object({
  id: z.uuid(),
  type: serviceRequestTypeSchema,
  status: serviceRequestStatusSchema,
  title: z.string(),
  category: categoryRefSchema,
  location: approximateLocationSchema,
  budget: moneySchema.nullable(),
  quoteCount: z.number().int(),
  openQuoteCount: z.number().int(),
  agreedPrice: moneySchema.nullable(),
  jobId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}) satisfies z.ZodType<ServiceRequestListItem>;

export const opportunitySchema = z.object({
  id: z.uuid(),
  type: serviceRequestTypeSchema,
  status: serviceRequestStatusSchema,
  title: z.string(),
  description: z.string(),
  category: categoryRefSchema,
  location: approximateLocationSchema,
  budget: moneySchema.nullable(),
  preferredStartAt: nullableDate,
  preferredEndAt: nullableDate,
  publishedAt: nullableDate,
  expiresAt: nullableDate,
  photos: z.array(photoSchema),
  myQuoteId: z.uuid().nullable(),
}) satisfies z.ZodType<Opportunity>;

export const quoteRevisionSchema = z.object({
  id: z.uuid(),
  revisionNo: z.number().int(),
  kind: quoteRevisionKindSchema,
  by: z.enum(['PROVIDER', 'CUSTOMER']),
  total: moneySchema,
  labor: moneySchema.nullable(),
  material: moneySchema.nullable(),
  materialsIncluded: z.boolean().nullable(),
  note: z.string().nullable(),
  estimatedDurationMinutes: z.number().int().nullable(),
  availableFrom: nullableDate,
  validUntil: nullableDate,
  createdAt: z.iso.datetime(),
}) satisfies z.ZodType<QuoteRevision>;

const turnSchema = z.enum(['CUSTOMER', 'PROVIDER']).nullable();

export const quoteSchema = z.object({
  id: z.uuid(),
  serviceRequestId: z.uuid(),
  requestType: serviceRequestTypeSchema,
  status: quoteStatusSchema,
  turn: turnSchema,
  provider: z.object({
    id: z.uuid(),
    displayName: z.string(),
    yearsOfExperience: z.number().int().nullable(),
    identityVerified: z.boolean(),
    rating: z.object({ average: z.number(), count: z.number().int() }).nullable(),
    completedJobCount: z.number().int(),
  }),
  latest: quoteRevisionSchema,
  revisions: z.array(quoteRevisionSchema),
  acceptedRevisionId: z.uuid().nullable(),
  acceptedAt: nullableDate,
  jobId: z.uuid().nullable(),
  actions: z.object({
    counter: z.boolean(),
    accept: z.boolean(),
    reject: z.boolean(),
    withdraw: z.boolean(),
  }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}) satisfies z.ZodType<Quote>;

export const providerQuoteListItemSchema = z.object({
  id: z.uuid(),
  status: quoteStatusSchema,
  turn: turnSchema,
  latest: quoteRevisionSchema,
  revisionCount: z.number().int(),
  request: z.object({
    id: z.uuid(),
    type: serviceRequestTypeSchema,
    status: serviceRequestStatusSchema,
    title: z.string(),
    category: categoryRefSchema,
    location: approximateLocationSchema,
    budget: moneySchema.nullable(),
  }),
  jobId: z.uuid().nullable(),
  updatedAt: z.iso.datetime(),
}) satisfies z.ZodType<ProviderQuoteListItem>;

export const jobSchema = z.object({
  id: z.uuid(),
  status: jobStatusSchema,
  agreedPrice: moneySchema,
  currentTotal: moneySchema,
  scheduledStartAt: nullableDate,
  createdAt: z.iso.datetime(),
  serviceRequest: z.object({
    id: z.uuid(),
    type: serviceRequestTypeSchema,
    title: z.string(),
    description: z.string(),
  }),
  category: categoryRefSchema,
  address: serviceAddressSchema,
  provider: z.object({ id: z.uuid(), displayName: z.string(), phone: z.string().nullable() }),
  customer: z.object({ name: z.string(), phone: z.string().nullable() }),
  acceptedRevision: quoteRevisionSchema.nullable(),
  viewerRole: z.enum(['CUSTOMER', 'PROVIDER']),
  enRouteAt: nullableDate,
  arrivedAt: nullableDate,
  startedAt: nullableDate,
  completionRequestedAt: nullableDate,
  completedAt: nullableDate,
  disputedAt: nullableDate,
  cancelledAt: nullableDate,
  cancellationActor: jobActorSchema.nullable(),
  cancellationReason: z.string().nullable(),
  timeline: z.array(jobTimelineEntrySchema),
  changeOrders: z.array(changeOrderSchema),
  review: reviewSchema.nullable(),
  dispute: jobDisputeSchema.nullable(),
  actions: jobActionsSchema,
}) satisfies z.ZodType<Job>;

export const jobListItemSchema = z.object({
  id: z.uuid(),
  status: jobStatusSchema,
  requestType: serviceRequestTypeSchema,
  agreedPrice: moneySchema,
  currentTotal: moneySchema,
  title: z.string(),
  category: categoryRefSchema,
  location: approximateLocationSchema,
  counterpart: z.string(),
  scheduledStartAt: nullableDate,
  createdAt: z.iso.datetime(),
}) satisfies z.ZodType<JobListItem>;

export const appNotificationSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  data: z.record(z.string(), z.string()).nullable(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  deepLink: z.string().nullable(),
  readAt: nullableDate,
  createdAt: z.iso.datetime(),
}) satisfies z.ZodType<AppNotification>;

export const adminDashboardStatsSchema = z.object({
  totalUsers: z.number().int(),
  activeProviders: z.number().int(),
  pendingProviders: z.number().int(),
  openServiceRequests: z.number().int(),
  openNowRequests: z.number().int(),
  newServiceRequestsToday: z.number().int(),
  jobsCreated: z.number().int(),
  timeZone: z.string(),
  generatedAt: z.iso.datetime(),
}) satisfies z.ZodType<AdminDashboardStats>;

export const adminServiceRequestListItemSchema = z.object({
  id: z.uuid(),
  type: serviceRequestTypeSchema,
  status: serviceRequestStatusSchema,
  title: z.string(),
  category: categoryRefSchema,
  location: approximateLocationSchema,
  budget: moneySchema.nullable(),
  quoteCount: z.number().int(),
  agreedPrice: moneySchema.nullable(),
  customer: z.object({ id: z.uuid(), name: z.string() }),
  createdAt: z.iso.datetime(),
}) satisfies z.ZodType<AdminServiceRequestListItem>;

export const adminServiceRequestDetailSchema = z.object({
  id: z.uuid(),
  type: serviceRequestTypeSchema,
  status: serviceRequestStatusSchema,
  title: z.string(),
  description: z.string(),
  category: categoryRefSchema,
  location: approximateLocationSchema.extend({ neighborhood: z.string().nullable() }),
  budget: moneySchema.nullable(),
  preferredStartAt: nullableDate,
  preferredEndAt: nullableDate,
  publishedAt: nullableDate,
  expiresAt: nullableDate,
  cancelledAt: nullableDate,
  cancelReason: z.string().nullable(),
  photoCount: z.number().int(),
  customer: z.object({ id: z.uuid(), name: z.string(), maskedPhone: z.string().nullable() }),
  quotes: z.array(
    z.object({
      id: z.uuid(),
      status: quoteStatusSchema,
      provider: z.object({ id: z.uuid(), displayName: z.string() }),
      revisions: z.array(quoteRevisionSchema),
      acceptedRevisionId: z.uuid().nullable(),
      createdAt: z.iso.datetime(),
    }),
  ),
  job: jobSummarySchema.extend({ currentTotal: moneySchema }).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}) satisfies z.ZodType<AdminServiceRequestDetail>;

export const adminSystemStatusSchema = z.object({
  environment: z.enum(['development', 'test', 'staging', 'production']),
  version: z.string(),
  database: z.enum(['up', 'down']),
  redis: z.enum(['up', 'down']),
  storageDriver: z.string(),
  smsProvider: z.string(),
  swaggerEnabled: z.boolean(),
  corsOrigins: z.array(z.string()),
  checkedAt: z.iso.datetime(),
}) satisfies z.ZodType<AdminSystemStatus>;
