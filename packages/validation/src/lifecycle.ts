import type {
  ChangeOrder,
  JobActions,
  JobDispute,
  JobTimelineEntry,
  NotificationPreferences,
  ProviderPenalty,
  ProviderQuality,
  PublicReview,
  Review,
  UnreadNotificationCount,
} from '@ustago/types';
import { z } from 'zod';

import { moneySchema, priceMinorSchema } from './money.js';

/**
 * Job lifecycle, change orders, disputes, reviews, provider quality and
 * notification preferences (Faz 4, docs/adr/0015-0017). The API and the
 * mobile app validate with the same rules.
 */

/** A customer may edit their review for this many days. */
export const REVIEW_EDIT_WINDOW_DAYS = 30;
export const REVIEW_COMMENT_MAX_LENGTH = 1000;
export const CHANGE_ORDER_DESCRIPTION_MIN_LENGTH = 10;
export const CHANGE_ORDER_DESCRIPTION_MAX_LENGTH = 1000;
export const DISPUTE_DESCRIPTION_MAX_LENGTH = 2000;

export const jobActorSchema = z.enum(['CUSTOMER', 'PROVIDER', 'ADMIN', 'SYSTEM']);
export const jobStepSchema = z.enum([
  'AGREED',
  'EN_ROUTE',
  'ARRIVED',
  'STARTED',
  'COMPLETION_REQUESTED',
  'COMPLETED',
]);
export const changeOrderStatusSchema = z.enum([
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
]);
export const disputeReasonSchema = z.enum([
  'NO_SHOW',
  'POOR_QUALITY',
  'PRICE_DISAGREEMENT',
  'PAYMENT_ISSUE',
  'DAMAGE',
  'MISCONDUCT',
  'OTHER',
]);
export const disputeStatusSchema = z.enum([
  'OPEN',
  'AWAITING_EVIDENCE',
  'UNDER_REVIEW',
  'RESOLVED_FOR_CUSTOMER',
  'RESOLVED_FOR_PROVIDER',
  'RESOLVED_PARTIAL',
  'CLOSED',
]);
export const reviewStatusSchema = z.enum(['PUBLISHED', 'UNDER_MODERATION', 'HIDDEN']);
export const disciplinaryActionTypeSchema = z.enum([
  'WARNING',
  'VISIBILITY_REDUCTION',
  'NOW_SUSPENSION',
  'JOB_RESTRICTION',
  'TEMPORARY_SUSPENSION',
  'PERMANENT_BAN',
]);
export const disciplinaryActionStatusSchema = z.enum([
  'ACTIVE',
  'UNDER_APPEAL',
  'REVOKED',
  'EXPIRED',
]);
export const penaltySeveritySchema = z.enum(['WARNING', 'MINOR', 'MAJOR', 'CRITICAL']);
export const qualityFactorKeySchema = z.enum([
  'REVIEWS',
  'COMPLETION',
  'CANCELLATION',
  'DISPUTES',
  'RESPONSE',
  'VERIFICATION',
  'EXPERIENCE',
]);

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

const HTML_TAG = /<\/?[a-z!][^>]*>/i;

/** Drops C0 control characters (except tab and newline) and DEL. */
function withoutControlChars(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    const control = (code < 0x20 && ch !== '\t' && ch !== '\n' && ch !== '\r') || code === 0x7f;
    if (!control) out += ch;
  }
  return out;
}

/**
 * User-written text shown to other users (reviews, change orders,
 * disputes). Plain text only: HTML is refused rather than silently
 * stripped, control characters are removed, runs of blank lines collapse.
 */
export function plainTextSchema(min: number, max: number, tooShort?: string) {
  return z
    .string()
    .transform((value) =>
      withoutControlChars(value)
        .replace(/\r\n?/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
    )
    .pipe(
      z
        .string()
        .min(min, tooShort ?? `En az ${min} karakter yazın.`)
        .max(max, `En fazla ${max} karakter yazabilirsiniz.`)
        .refine((value) => !HTML_TAG.test(value), 'Metin HTML içeremez; düz yazı kullanın.'),
    );
}

/** "Ayşe Demir" → "Ayşe D." (public review author). */
export function maskPersonName(firstName: string, lastName: string): string {
  const first = firstName.trim().split(/\s+/)[0] ?? '';
  const initial = lastName.trim().charAt(0).toLocaleUpperCase('tr-TR');
  if (!first) return 'UstaGO kullanıcısı';
  return initial ? `${first} ${initial}.` : first;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/**
 * Extra work during a job. The amount is the extra, in kuruş, always
 * positive; the same 1 TL - 10.000.000 TL bounds as any price.
 */
export const createChangeOrderSchema = z
  .object({
    amountMinor: priceMinorSchema,
    description: plainTextSchema(
      CHANGE_ORDER_DESCRIPTION_MIN_LENGTH,
      CHANGE_ORDER_DESCRIPTION_MAX_LENGTH,
      'Ek işin nedenini en az 10 karakterle açıklayın.',
    ),
  })
  .strict();
export type CreateChangeOrder = z.infer<typeof createChangeOrderSchema>;

export const cancelJobSchema = z
  .object({ reason: plainTextSchema(3, 500, 'Lütfen iptal nedenini yazın.') })
  .strict();
export type CancelJob = z.infer<typeof cancelJobSchema>;

export const openDisputeSchema = z
  .object({
    reason: disputeReasonSchema,
    description: plainTextSchema(
      10,
      DISPUTE_DESCRIPTION_MAX_LENGTH,
      'Sorunu en az 10 karakterle anlatın.',
    ),
  })
  .strict();
export type OpenDispute = z.infer<typeof openDisputeSchema>;

export const starRatingSchema = z
  .number({ message: 'Puan 1 ile 5 arasında olmalı.' })
  .int('Puan 1 ile 5 arasında olmalı.')
  .min(1, 'Puan 1 ile 5 arasında olmalı.')
  .max(5, 'Puan 1 ile 5 arasında olmalı.');

/** Overall rating is required; the four detail ratings and the comment are optional. */
export const createReviewSchema = z
  .object({
    rating: starRatingSchema,
    qualityRating: starRatingSchema.nullable().optional(),
    communicationRating: starRatingSchema.nullable().optional(),
    punctualityRating: starRatingSchema.nullable().optional(),
    valueRating: starRatingSchema.nullable().optional(),
    comment: plainTextSchema(0, REVIEW_COMMENT_MAX_LENGTH)
      .transform((value) => (value === '' ? null : value))
      .nullable()
      .optional(),
  })
  .strict();
export type CreateReview = z.infer<typeof createReviewSchema>;

export const updateReviewSchema = createReviewSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'En az bir alan gönderin.' });
export type UpdateReview = z.infer<typeof updateReviewSchema>;

export const notificationCategorySchema = z.enum(['JOBS', 'MESSAGES', 'FINANCE', 'ACCOUNT']);

export const listNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(30),
  cursor: z.uuid().optional(),
  /** Faz 7 notification centre tab. */
  category: notificationCategorySchema.optional(),
  unreadOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const updateNotificationPreferencesSchema = z
  .object({
    quoteUpdatesPush: z.boolean().optional(),
    marketingPush: z.boolean().optional(),
    newMessagePush: z.boolean().optional(),
    newJobAlerts: z.enum(['ON', 'SILENT', 'OFF']).optional(),
    /** Both or neither (null clears quiet hours). */
    quietHoursStart: z.number().int().min(0).max(1439).nullable().optional(),
    quietHoursEnd: z.number().int().min(0).max(1439).nullable().optional(),
  })
  .strict()
  .refine(
    (v) =>
      (v.quietHoursStart === undefined) === (v.quietHoursEnd === undefined) &&
      (v.quietHoursStart === null) === (v.quietHoursEnd === null) &&
      ((v.quietHoursStart ?? null) === null || v.quietHoursStart !== v.quietHoursEnd),
    { path: ['quietHoursEnd'], message: 'Sessiz saatler için başlangıç ve bitişi birlikte girin.' },
  )
  .refine((value) => Object.keys(value).length > 0, { message: 'En az bir alan gönderin.' });
export type UpdateNotificationPreferences = z.infer<typeof updateNotificationPreferencesSchema>;

export const listProviderReviewsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  cursor: z.uuid().optional(),
  /** Faz 7: NEWEST keeps the id cursor; HIGHEST / LOWEST use offset pages. */
  sort: z.enum(['NEWEST', 'HIGHEST', 'LOWEST']).default('NEWEST'),
  page: z.coerce.number().int().min(0).max(1000).default(0),
  /** Faz 7: only reviews with this overall rating (1-5). */
  rating: z.coerce.number().int().min(1).max(5).optional(),
});

/** POST /reviews/:id/reply: the provider's one public answer. */
export const replyToReviewSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(3, 'Cevap en az 3 karakter olmalı.')
      .max(1000)
      .refine((v) => !/[<>]/.test(v), 'Cevapta < ve > karakterleri kullanılamaz.'),
  })
  .strict();
export type ReplyToReview = z.infer<typeof replyToReviewSchema>;
export type ListProviderReviewsQuery = z.infer<typeof listProviderReviewsQuerySchema>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

const nullableDate = z.iso.datetime().nullable();
const nullableRating = z.number().int().min(1).max(5).nullable();

export const jobTimelineEntrySchema = z.object({
  step: jobStepSchema,
  at: nullableDate,
}) satisfies z.ZodType<JobTimelineEntry>;

export const changeOrderSchema = z.object({
  id: z.uuid(),
  jobId: z.uuid(),
  status: changeOrderStatusSchema,
  amount: moneySchema,
  description: z.string(),
  previousTotal: moneySchema,
  proposedTotal: moneySchema,
  createdAt: z.iso.datetime(),
  respondedAt: nullableDate,
}) satisfies z.ZodType<ChangeOrder>;

export const jobDisputeSchema = z.object({
  id: z.uuid(),
  status: disputeStatusSchema,
  reason: disputeReasonSchema,
  description: z.string(),
  resolution: z.string().nullable(),
  createdAt: z.iso.datetime(),
  resolvedAt: nullableDate,
}) satisfies z.ZodType<JobDispute>;

export const reviewSchema = z.object({
  id: z.uuid(),
  jobId: z.uuid(),
  status: reviewStatusSchema,
  rating: z.number().int().min(1).max(5),
  qualityRating: nullableRating,
  communicationRating: nullableRating,
  punctualityRating: nullableRating,
  valueRating: nullableRating,
  comment: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  editableUntil: z.iso.datetime(),
}) satisfies z.ZodType<Review>;

export const jobActionsSchema = z.object({
  enRoute: z.boolean(),
  arrive: z.boolean(),
  start: z.boolean(),
  addChangeOrder: z.boolean(),
  requestCompletion: z.boolean(),
  complete: z.boolean(),
  dispute: z.boolean(),
  cancel: z.boolean(),
  review: z.boolean(),
  editReview: z.boolean(),
}) satisfies z.ZodType<JobActions>;

export const publicReviewSchema = z
  .object({
    id: z.uuid(),
    rating: z.number().int().min(1).max(5),
    qualityRating: nullableRating,
    communicationRating: nullableRating,
    punctualityRating: nullableRating,
    valueRating: nullableRating,
    comment: z.string().nullable(),
    authorName: z.string(),
    categoryName: z.string(),
    createdAt: z.iso.datetime(),
    reply: z.object({ body: z.string(), createdAt: z.iso.datetime() }).nullable(),
  })
  .strict() satisfies z.ZodType<PublicReview>;

const namedRef = z.object({ id: z.uuid(), name: z.string() });

export const providerPenaltySchema = z.object({
  id: z.uuid(),
  type: disciplinaryActionTypeSchema,
  severity: penaltySeveritySchema,
  status: disciplinaryActionStatusSchema,
  reasonCode: z.string(),
  reason: z.string(),
  disputeId: z.uuid().nullable(),
  startsAt: z.iso.datetime(),
  endsAt: nullableDate,
  decidedBy: namedRef.nullable(),
  createdAt: z.iso.datetime(),
}) satisfies z.ZodType<ProviderPenalty>;

export const providerQualitySchema = z.object({
  providerId: z.uuid(),
  completedJobs: z.number().int(),
  providerCancelledJobs: z.number().int(),
  customerCancelledJobs: z.number().int(),
  openDisputes: z.number().int(),
  reviewCount: z.number().int(),
  ratingAverage: z.number().nullable(),
  ustaScore: z.number().nullable(),
  isNewProvider: z.boolean(),
  algorithmVersion: z.string().nullable(),
  computedAt: nullableDate,
  factors: z.array(
    z.object({
      key: qualityFactorKeySchema,
      weight: z.number(),
      effectiveWeight: z.number(),
      score: z.number().nullable(),
      detail: z.string(),
    }),
  ),
  penaltyPoints: z.number(),
  penalties: z.array(providerPenaltySchema),
}) satisfies z.ZodType<ProviderQuality>;

export const notificationPreferencesSchema = z.object({
  jobUpdatesPush: z.literal(true),
  financePush: z.literal(true),
  quoteUpdatesPush: z.boolean(),
  newMessagePush: z.boolean(),
  marketingPush: z.boolean(),
  newJobAlerts: z.enum(['ON', 'SILENT', 'OFF']),
  quietHoursStart: z.number().int().nullable(),
  quietHoursEnd: z.number().int().nullable(),
}) satisfies z.ZodType<NotificationPreferences>;

export const unreadNotificationCountSchema = z.object({
  unread: z.number().int().min(0),
}) satisfies z.ZodType<UnreadNotificationCount>;
