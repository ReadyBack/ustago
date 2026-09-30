import type {
  AdminDisputeDetail,
  AdminDisputeListItem,
  AdminJobDetail,
  AdminJobListItem,
  AdminReview,
} from '@ustago/types';
import { z } from 'zod';

import {
  changeOrderSchema,
  disciplinaryActionTypeSchema,
  disputeReasonSchema,
  disputeStatusSchema,
  jobActorSchema,
  jobTimelineEntrySchema,
  plainTextSchema,
  reviewStatusSchema,
} from './lifecycle.js';
import {
  approximateLocationSchema,
  categoryRefSchema,
  jobStatusSchema,
  quoteRevisionSchema,
  serviceRequestTypeSchema,
} from './marketplace.js';
import { moneySchema } from './money.js';

/** Admin: jobs, disputes, reviews and penalties (Faz 4). */

const isoDate = z.iso.datetime({ offset: true });

export const listAdminJobsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
  status: jobStatusSchema.optional(),
  providerId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  provinceId: z.coerce.number().int().min(1).max(81).optional(),
  categoryId: z.uuid().optional(),
  /** Created at or after (inclusive). */
  from: isoDate.optional(),
  /** Created before (exclusive). */
  to: isoDate.optional(),
});
export type ListAdminJobsQuery = z.infer<typeof listAdminJobsQuerySchema>;

/** OPEN = not yet decided (open, awaiting evidence, under review). */
export const disputeGroupSchema = z.enum(['OPEN', 'RESOLVED']);

export const listAdminDisputesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
  group: disputeGroupSchema.optional(),
});
export type ListAdminDisputesQuery = z.infer<typeof listAdminDisputesQuerySchema>;

export const resolveDisputeSchema = z
  .object({
    outcome: z.enum([
      'RESOLVED_FOR_CUSTOMER',
      'RESOLVED_FOR_PROVIDER',
      'RESOLVED_PARTIAL',
      'CLOSED',
    ]),
    /** Internal note; shown to both parties as the resolution text. */
    note: plainTextSchema(3, 2000, 'Karar notu en az 3 karakter olmalı.'),
  })
  .strict();
export type ResolveDispute = z.infer<typeof resolveDisputeSchema>;

export const listAdminReviewsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
  status: reviewStatusSchema.optional(),
  providerId: z.uuid().optional(),
});
export type ListAdminReviewsQuery = z.infer<typeof listAdminReviewsQuerySchema>;

export const moderateReviewSchema = z
  .object({ reason: plainTextSchema(3, 500, 'Gerekçe en az 3 karakter olmalı.') })
  .strict();
export type ModerateReview = z.infer<typeof moderateReviewSchema>;

/**
 * An admin decision. CRITICAL types (temporary suspension, permanent ban)
 * are not created here: suspending an account is the provider review flow,
 * always a separate, explicit admin action.
 */
export const createPenaltySchema = z
  .object({
    type: disciplinaryActionTypeSchema.exclude(['TEMPORARY_SUSPENSION', 'PERMANENT_BAN']),
    reasonCode: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_]{2,59}$/, 'Kod BÜYÜK_HARF_VE_ALT_ÇİZGİ olmalı (ör. NO_SHOW).'),
    reason: plainTextSchema(10, 2000, 'Gerekçe en az 10 karakter olmalı.'),
    /** Omitted: until revoked. */
    endsAt: isoDate.nullable().optional(),
    disputeId: z.uuid().nullable().optional(),
  })
  .strict();
export type CreatePenalty = z.infer<typeof createPenaltySchema>;

export const revokePenaltySchema = z
  .object({ reason: plainTextSchema(3, 500, 'Gerekçe en az 3 karakter olmalı.') })
  .strict();
export type RevokePenalty = z.infer<typeof revokePenaltySchema>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

const nullableDate = z.iso.datetime().nullable();
const nullableRating = z.number().int().min(1).max(5).nullable();
const namedRef = z.object({ id: z.uuid(), name: z.string() });

export const adminJobListItemSchema = z.object({
  id: z.uuid(),
  status: jobStatusSchema,
  requestType: serviceRequestTypeSchema,
  title: z.string(),
  category: categoryRefSchema,
  location: approximateLocationSchema,
  customer: z.object({ id: z.uuid(), name: z.string() }),
  provider: z.object({ id: z.uuid(), displayName: z.string() }),
  agreedPrice: moneySchema,
  currentTotal: moneySchema,
  createdAt: z.iso.datetime(),
}) satisfies z.ZodType<AdminJobListItem>;

export const adminReviewSchema = z.object({
  id: z.uuid(),
  status: reviewStatusSchema,
  rating: z.number().int().min(1).max(5),
  qualityRating: nullableRating,
  communicationRating: nullableRating,
  punctualityRating: nullableRating,
  valueRating: nullableRating,
  comment: z.string().nullable(),
  jobId: z.uuid(),
  provider: z.object({ id: z.uuid(), displayName: z.string() }),
  customerName: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  moderatedAt: nullableDate,
  moderationReason: z.string().nullable(),
}) satisfies z.ZodType<AdminReview>;

export const adminDisputeListItemSchema = z.object({
  id: z.uuid(),
  status: disputeStatusSchema,
  reason: disputeReasonSchema,
  job: z.object({ id: z.uuid(), title: z.string(), status: jobStatusSchema }),
  customer: z.object({ id: z.uuid(), name: z.string() }),
  provider: z.object({ id: z.uuid(), displayName: z.string() }),
  createdAt: z.iso.datetime(),
  resolvedAt: nullableDate,
}) satisfies z.ZodType<AdminDisputeListItem>;

export const adminDisputeDetailSchema = adminDisputeListItemSchema.extend({
  description: z.string(),
  resolution: z.string().nullable(),
  resolvedBy: namedRef.nullable(),
  timeline: z.array(jobTimelineEntrySchema),
}) satisfies z.ZodType<AdminDisputeDetail>;

export const adminJobDetailSchema = adminJobListItemSchema.extend({
  serviceRequest: z.object({
    id: z.uuid(),
    title: z.string(),
    description: z.string(),
    budget: moneySchema.nullable(),
  }),
  location: approximateLocationSchema.extend({ neighborhood: z.string().nullable() }),
  customer: z.object({ id: z.uuid(), name: z.string(), maskedPhone: z.string().nullable() }),
  negotiation: z.array(quoteRevisionSchema),
  acceptedRevisionId: z.uuid().nullable(),
  timeline: z.array(jobTimelineEntrySchema),
  statusHistory: z.array(
    z.object({
      from: jobStatusSchema.nullable(),
      to: jobStatusSchema,
      actor: jobActorSchema.nullable(),
      reason: z.string().nullable(),
      at: z.iso.datetime(),
    }),
  ),
  changeOrders: z.array(changeOrderSchema),
  review: adminReviewSchema.nullable(),
  disputes: z.array(adminDisputeListItemSchema),
  cancellation: z
    .object({
      at: z.iso.datetime(),
      actor: jobActorSchema.nullable(),
      reason: z.string().nullable(),
    })
    .nullable(),
  audit: z.array(
    z.object({ action: z.string(), entityType: z.string().nullable(), at: z.iso.datetime() }),
  ),
}) satisfies z.ZodType<AdminJobDetail>;
