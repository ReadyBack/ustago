import type {
  ActiveSession,
  AdminPermission,
  ProviderAccountStatus,
  ProviderVerificationStatus,
  RiskSignalType,
} from '@ustago/types';
import { z } from 'zod';

import { paginationQuerySchema } from './common.js';
import { verificationTypeSchema } from './providers.js';

export const providerVerificationStatusSchema = z.enum([
  'NOT_STARTED',
  'IN_PROGRESS',
  'SUBMITTED',
  'UNDER_REVIEW',
  'NEEDS_REVISION',
  'VERIFIED',
  'REJECTED',
  'SUSPENDED',
]) satisfies z.ZodType<ProviderVerificationStatus>;

export const providerAccountStatusSchema = z.enum([
  'ACTIVE',
  'LIMITED',
  'SUSPENDED',
  'BANNED',
]) satisfies z.ZodType<ProviderAccountStatus>;

export const adminPermissionSchema = z.enum([
  'ADMIN_SUPPORT',
  'ADMIN_VERIFICATION',
  'ADMIN_FINANCE',
  'ADMIN_SUPER',
]) satisfies z.ZodType<AdminPermission>;

/** Machine-readable reason codes; free text goes in the note fields. */
const reasonCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9_]{2,59}$/, { message: 'Geçerli bir gerekçe kodu seçin.' });

/** Shown to the provider. */
const userVisibleReasonSchema = z.string().trim().min(5).max(500);
/** Admins only; never returned to the provider. */
const internalNoteSchema = z.string().trim().max(2000);

export const VERIFICATION_REASON_CODES = [
  'DOCUMENT_UNREADABLE',
  'DOCUMENT_EXPIRED',
  'DOCUMENT_MISMATCH',
  'MISSING_DOCUMENT',
  'PROFILE_INCOMPLETE',
  'SUSPECTED_FRAUD',
  'NOT_ELIGIBLE',
  'OTHER',
] as const;

export const SUSPENSION_REASON_CODES = [
  'QUALITY_ISSUES',
  'POLICY_VIOLATION',
  'FRAUD_INVESTIGATION',
  'DOCUMENT_ISSUE',
  'PAYMENT_ISSUE',
  'LEGACY_SUSPENSION',
  'OTHER',
] as const;

export const listVerificationCasesQuerySchema = paginationQuerySchema
  .extend({
    status: z
      .enum(['SUBMITTED', 'UNDER_REVIEW', 'NEEDS_REVISION', 'VERIFIED', 'REJECTED', 'SUSPENDED'])
      .default('SUBMITTED'),
  })
  .strict();
export type ListVerificationCasesQuery = z.infer<typeof listVerificationCasesQuerySchema>;

/** Every admin decision carries the case version it was made against. */
const expectedVersion = z.number().int().min(0);

export const startVerificationReviewRequestSchema = z.object({ expectedVersion }).strict();
export type StartVerificationReviewRequest = z.infer<typeof startVerificationReviewRequestSchema>;

export const approveVerificationRequestSchema = z
  .object({ expectedVersion, internalNote: internalNoteSchema.optional() })
  .strict();
export type ApproveVerificationRequest = z.infer<typeof approveVerificationRequestSchema>;

export const verificationDecisionRequestSchema = z
  .object({
    expectedVersion,
    reasonCode: z.enum(VERIFICATION_REASON_CODES),
    userVisibleReason: userVisibleReasonSchema,
    internalNote: internalNoteSchema.optional(),
    /** Documents to mark as rejected together with a revision request. */
    rejectDocumentIds: z.array(z.uuid()).max(20).optional(),
  })
  .strict();
export type VerificationDecisionRequest = z.infer<typeof verificationDecisionRequestSchema>;

export const suspendProviderRequestSchema = z
  .object({
    level: z.enum(['SUSPENDED', 'BANNED']).default('SUSPENDED'),
    reasonCode: z.enum(SUSPENSION_REASON_CODES),
    userVisibleReason: userVisibleReasonSchema,
    internalNote: internalNoteSchema.optional(),
    /** Absent: until lifted. BANNED is never temporary. */
    expiresAt: z.coerce.date().optional(),
    /** On expiry: lift automatically, or wait for an admin review. */
    autoLift: z.boolean().default(false),
  })
  .strict()
  .refine((v) => v.level !== 'BANNED' || v.expiresAt === undefined, {
    message: 'Kalıcı yasak süreli olamaz.',
    path: ['expiresAt'],
  });
export type SuspendProviderRequest = z.infer<typeof suspendProviderRequestSchema>;

export const liftSuspensionRequestSchema = z
  .object({ note: z.string().trim().min(5).max(1000) })
  .strict();
export type LiftSuspensionRequest = z.infer<typeof liftSuspensionRequestSchema>;

export const categoryRequirementRequestSchema = z
  .object({
    documentType: verificationTypeSchema,
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type CategoryRequirementRequest = z.infer<typeof categoryRequirementRequestSchema>;

export const setAdminPermissionsRequestSchema = z
  .object({
    permissions: z
      .array(adminPermissionSchema)
      .max(4)
      .refine((p) => new Set(p).size === p.length, { message: 'Aynı yetki iki kez gönderildi.' }),
    /** Re-typed by the admin as a confirmation. */
    confirm: z.literal(true),
  })
  .strict();
export type SetAdminPermissionsRequest = z.infer<typeof setAdminPermissionsRequestSchema>;

export const activeSessionSchema = z.object({
  id: z.uuid(),
  current: z.boolean(),
  deviceName: z.string().nullable(),
  platform: z.enum(['IOS', 'ANDROID', 'WEB']).nullable(),
  userAgentSummary: z.string().nullable(),
  createdApprox: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
}) satisfies z.ZodType<ActiveSession>;

export const riskSignalTypeSchema = z.enum([
  'OTP_ABUSE',
  'QUOTE_SPAM',
  'CANCEL_ABUSE',
  'PAYMENT_ABUSE',
  'REVIEW_ABUSE',
  'DEVICE_ANOMALY',
  'ADMIN_FLAG',
]) satisfies z.ZodType<RiskSignalType>;

export const listRiskSignalsQuerySchema = paginationQuerySchema
  .extend({
    status: z.enum(['OPEN', 'REVIEWED', 'DISMISSED']).default('OPEN'),
    type: riskSignalTypeSchema.optional(),
  })
  .strict();
export type ListRiskSignalsQuery = z.infer<typeof listRiskSignalsQuerySchema>;

export const reviewRiskSignalRequestSchema = z
  .object({
    status: z.enum(['REVIEWED', 'DISMISSED']),
    note: z.string().trim().min(3).max(1000),
  })
  .strict();
export type ReviewRiskSignalRequest = z.infer<typeof reviewRiskSignalRequestSchema>;

export const flagUserRequestSchema = z
  .object({ note: z.string().trim().min(5).max(1000) })
  .strict();
export type FlagUserRequest = z.infer<typeof flagUserRequestSchema>;

export const requestAccountDeletionSchema = z
  .object({ confirm: z.literal('HESABIMI SIL') })
  .strict();
export type RequestAccountDeletion = z.infer<typeof requestAccountDeletionSchema>;
