import { z } from 'zod';

import { paginationQuerySchema } from './common.js';

/**
 * A new fee policy starts as a DRAFT; publishing freezes it (the database
 * refuses later edits). effectiveFrom must be in the future at publish time
 * so jobs already priced keep their snapshot.
 */
export const createFeePolicyRequestSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{2,59}$/, { message: 'Kod küçük harf, rakam ve tire içermeli.' }),
    name: z.string().trim().min(3).max(120),
    bps: z.number().int().min(0).max(5000),
    fixedMinor: z.number().int().min(0).max(100_000_00).default(0),
    minMinor: z.number().int().min(0).max(100_000_00).nullable().default(null),
    maxMinor: z.number().int().min(0).max(100_000_00).nullable().default(null),
    effectiveFrom: z.coerce.date(),
  })
  .strict()
  .refine((v) => v.minMinor === null || v.maxMinor === null || v.minMinor <= v.maxMinor, {
    message: 'Alt sınır üst sınırdan büyük olamaz.',
    path: ['minMinor'],
  });
export type CreateFeePolicyRequest = z.infer<typeof createFeePolicyRequestSchema>;

export const publishFeePolicyRequestSchema = z.object({ confirm: z.literal(true) }).strict();
export type PublishFeePolicyRequest = z.infer<typeof publishFeePolicyRequestSchema>;

export const feePreviewQuerySchema = z
  .object({
    bps: z.coerce.number().int().min(0).max(5000),
    fixedMinor: z.coerce.number().int().min(0).default(0),
    minMinor: z.coerce.number().int().min(0).optional(),
    maxMinor: z.coerce.number().int().min(0).optional(),
  })
  .strict();
export type FeePreviewQuery = z.infer<typeof feePreviewQuerySchema>;

/** Gross amounts the preview always shows, in kuruş (₺500 ... ₺10.000). */
export const FEE_PREVIEW_AMOUNTS_MINOR = [50_000, 100_000, 250_000, 500_000, 1_000_000] as const;

export const listAlertsQuerySchema = paginationQuerySchema
  .extend({
    status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'ACTIVE']).default('ACTIVE'),
    severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
  })
  .strict();
export type ListAlertsQuery = z.infer<typeof listAlertsQuerySchema>;

export const resolveAlertRequestSchema = z
  .object({ note: z.string().trim().min(5).max(1000) })
  .strict();
export type ResolveAlertRequest = z.infer<typeof resolveAlertRequestSchema>;

export const listReconciliationRunsQuerySchema = paginationQuerySchema.strict();
export type ListReconciliationRunsQuery = z.infer<typeof listReconciliationRunsQuerySchema>;

export const setRuntimeFlagRequestSchema = z
  .object({
    enabled: z.boolean(),
    reason: z.string().trim().min(5).max(500),
    confirm: z.literal(true),
  })
  .strict();
export type SetRuntimeFlagRequest = z.infer<typeof setRuntimeFlagRequestSchema>;

export const verifyPayoutDestinationRequestSchema = z
  .object({ note: z.string().trim().min(5).max(500) })
  .strict();
export type VerifyPayoutDestinationRequest = z.infer<typeof verifyPayoutDestinationRequestSchema>;
