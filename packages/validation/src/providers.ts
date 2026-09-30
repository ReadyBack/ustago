import type {
  AdminProviderDetail,
  AdminProviderListItem,
  AdminProviderVerification,
  OnboardingStep,
  ProviderOnboardingStatus,
  ProviderProfile,
  ProviderServiceAreaGroup,
  ProviderServiceItem,
  ProviderVerification,
  PublicProviderProfile,
  SignedUrl,
  UploadIntentResponse,
  VerificationStatus,
  VerificationType,
} from '@ustago/types';
import { z } from 'zod';

import { providerStatusSchema, providerTypeSchema } from './auth.js';
import { paginationQuerySchema } from './common.js';
import { MAX_BIO_LENGTH } from './provider-ops.js';

/**
 * Faz 7: the bio is plain text everywhere it is written (same rules as
 * `plainTextBio`, without its 20-character minimum: a short draft is
 * allowed and onboarding reports it as incomplete instead).
 */
const bioTextSchema = z
  .string()
  .trim()
  .max(MAX_BIO_LENGTH)
  .refine((v) => !/[<>]/.test(v), 'Tanıtım metninde < ve > karakterleri kullanılamaz.')
  .refine(
    // eslint-disable-next-line no-control-regex
    (v) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(v),
    'Tanıtım metni geçersiz karakter içeriyor.',
  );

export const createProviderProfileRequestSchema = z
  .object({
    displayName: z.string().trim().min(2).max(120),
    type: providerTypeSchema.default('INDIVIDUAL'),
    bio: bioTextSchema.optional(),
    yearsOfExperience: z.number().int().min(0).max(70).optional(),
  })
  .strict();
export type CreateProviderProfileRequest = z.infer<typeof createProviderProfileRequestSchema>;

export const updateProviderProfileRequestSchema = z
  .object({
    displayName: z.string().trim().min(2).max(120).optional(),
    type: providerTypeSchema.optional(),
    bio: bioTextSchema.nullable().optional(),
    yearsOfExperience: z.number().int().min(0).max(70).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'En az bir alan gönderin.' });
export type UpdateProviderProfileRequest = z.infer<typeof updateProviderProfileRequestSchema>;

export const providerProfileSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  type: providerTypeSchema,
  status: providerStatusSchema,
  displayName: z.string(),
  bio: z.string().nullable(),
  yearsOfExperience: z.number().int().nullable(),
  nowEnabled: z.boolean(),
  isAvailableNow: z.boolean(),
  submittedAt: z.iso.datetime().nullable(),
  approvedAt: z.iso.datetime().nullable(),
  statusReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}) satisfies z.ZodType<ProviderProfile>;

// --- Services and service areas ---------------------------------------------

/** Unique ids; duplicates are a client bug, so they are rejected, not merged. */
const uniqueIds = (max: number) =>
  z
    .array(z.uuid())
    .max(max)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'Aynı kayıt iki kez gönderildi.',
    });

export const MAX_PROVIDER_SERVICES = 20;
export const MAX_SERVICE_AREA_DISTRICTS = 200;

/** Replaces the provider's categories. An empty list clears them (DRAFT only). */
export const setProviderServicesRequestSchema = z
  .object({ categoryIds: uniqueIds(MAX_PROVIDER_SERVICES) })
  .strict();
export type SetProviderServicesRequest = z.infer<typeof setProviderServicesRequestSchema>;

/**
 * Replaces the provider's districts. Districts are grouped under the
 * province the provider picked, and the API checks each district really is
 * in that province (DISTRICT_PROVINCE_MISMATCH).
 */
export const setProviderServiceAreasRequestSchema = z
  .object({
    areas: z
      .array(
        z
          .object({
            provinceId: z.number().int().min(1).max(81),
            districtIds: uniqueIds(MAX_SERVICE_AREA_DISTRICTS).refine((ids) => ids.length > 0, {
              message: 'En az bir ilçe seçin.',
            }),
          })
          .strict(),
      )
      .max(81)
      .refine((areas) => new Set(areas.map((a) => a.provinceId)).size === areas.length, {
        message: 'Her il bir kez gönderilmeli.',
      })
      .refine((areas) => areas.flatMap((a) => a.districtIds).length <= MAX_SERVICE_AREA_DISTRICTS, {
        message: `En fazla ${MAX_SERVICE_AREA_DISTRICTS} ilçe seçilebilir.`,
      })
      .refine(
        (areas) => {
          const all = areas.flatMap((a) => a.districtIds);
          return new Set(all).size === all.length;
        },
        { message: 'Aynı ilçe iki kez gönderildi.' },
      ),
  })
  .strict();
export type SetProviderServiceAreasRequest = z.infer<typeof setProviderServiceAreasRequestSchema>;

const namedRef = z.object({ id: z.uuid(), name: z.string() });
const provinceRef = z.object({ id: z.number().int(), name: z.string() });

export const providerServiceItemSchema = z.object({
  categoryId: z.uuid(),
  slug: z.string(),
  name: z.string(),
  supportsNow: z.boolean(),
  supportsQuote: z.boolean(),
}) satisfies z.ZodType<ProviderServiceItem>;

export const providerServiceAreaGroupSchema = z.object({
  province: provinceRef,
  districts: z.array(namedRef),
}) satisfies z.ZodType<ProviderServiceAreaGroup>;

// --- NOW availability -------------------------------------------------------

/**
 * nowEnabled: the provider wants NOW jobs (a preference, allowed during
 * onboarding). isAvailableNow: "müsaitim" right now (ACTIVE providers only).
 */
export const updateProviderAvailabilityRequestSchema = z
  .object({ nowEnabled: z.boolean().optional(), isAvailableNow: z.boolean().optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'En az bir alan gönderin.' });
export type UpdateProviderAvailabilityRequest = z.infer<
  typeof updateProviderAvailabilityRequestSchema
>;

// --- Verifications ----------------------------------------------------------

export const verificationTypeSchema = z.enum([
  'IDENTITY',
  'PROFESSIONAL_CERTIFICATE',
  'TAX_REGISTRATION',
  'BUSINESS_LICENSE',
  'CRIMINAL_RECORD',
  'BUSINESS_DOCUMENT',
  'OTHER',
]) satisfies z.ZodType<VerificationType>;

export const verificationStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
]) satisfies z.ZodType<VerificationStatus>;

/**
 * Document formats accepted for verification. SVG (can carry scripts),
 * HTML, archives and executables are never accepted. The API also checks
 * the file's magic bytes after upload (docs/adr/0011).
 */
export const ALLOWED_VERIFICATION_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
] as const;
export const verificationMimeTypeSchema = z.enum(ALLOWED_VERIFICATION_MIME_TYPES, {
  message: 'Yalnızca JPEG, PNG veya PDF yükleyebilirsiniz.',
});

function isHiddenCharacter(code: number): boolean {
  return (
    code <= 0x1f ||
    code === 0x7f ||
    (code >= 0x202a && code <= 0x202e) || // LRE..RLO
    (code >= 0x2066 && code <= 0x2069) // LRI..PDI
  );
}

/**
 * Reduces a client file name to a display-safe basename: no directories,
 * control characters or path tricks. It is only ever shown to admins; the
 * storage key is random and never derived from it.
 */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .normalize('NFC')
    // Control and bidi-override characters can disguise extensions.
    .split('')
    .filter((ch) => !isHiddenCharacter(ch.codePointAt(0) ?? 0))
    .join('')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  const limited = cleaned.slice(-255);
  return limited.length > 0 ? limited : 'belge';
}

export const createUploadIntentRequestSchema = z
  .object({
    type: verificationTypeSchema,
    fileName: z.string().min(1).max(1000).transform(sanitizeFileName),
    mimeType: verificationMimeTypeSchema,
    /** Declared size; the API rejects anything over VERIFICATION_MAX_FILE_BYTES. */
    sizeBytes: z.number().int().positive(),
  })
  .strict();
export type CreateUploadIntentRequest = z.infer<typeof createUploadIntentRequestSchema>;

export const submitVerificationRequestSchema = z
  .object({ type: verificationTypeSchema, uploadId: z.uuid() })
  .strict();
export type SubmitVerificationRequest = z.infer<typeof submitVerificationRequestSchema>;

export const providerVerificationSchema = z.object({
  id: z.uuid(),
  type: verificationTypeSchema,
  status: verificationStatusSchema,
  mimeType: z.string().nullable(),
  sizeBytes: z.number().int().nullable(),
  originalFileName: z.string().nullable(),
  submittedAt: z.iso.datetime(),
  reviewedAt: z.iso.datetime().nullable(),
  rejectionReason: z.string().nullable(),
}) satisfies z.ZodType<ProviderVerification>;

export const uploadIntentResponseSchema = z.object({
  uploadId: z.uuid(),
  uploadUrl: z.url(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
  maxSizeBytes: z.number().int(),
  expiresAt: z.iso.datetime(),
}) satisfies z.ZodType<UploadIntentResponse>;

export const signedUrlSchema = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime(),
}) satisfies z.ZodType<SignedUrl>;

// --- Onboarding status ------------------------------------------------------

export const onboardingStepSchema = z.enum([
  'PHONE_VERIFIED',
  'PROFILE',
  'SERVICES',
  'SERVICE_AREAS',
  'REQUIRED_VERIFICATIONS',
]) satisfies z.ZodType<OnboardingStep>;

export const providerOnboardingStatusSchema = z.object({
  providerStatus: providerStatusSchema,
  phoneVerified: z.boolean(),
  profileComplete: z.boolean(),
  servicesComplete: z.boolean(),
  serviceAreasComplete: z.boolean(),
  requiredVerificationsComplete: z.boolean(),
  requiredVerificationTypes: z.array(verificationTypeSchema),
  missingSteps: z.array(onboardingStepSchema),
  completedSteps: z.number().int(),
  totalSteps: z.number().int(),
  canSubmit: z.boolean(),
  statusReason: z.string().nullable(),
}) satisfies z.ZodType<ProviderOnboardingStatus>;

// --- Public profile ---------------------------------------------------------

export const publicProviderProfileSchema = z
  .object({
    id: z.uuid(),
    displayName: z.string(),
    type: providerTypeSchema,
    bio: z.string().nullable(),
    yearsOfExperience: z.number().int().nullable(),
    services: z.array(providerServiceItemSchema),
    serviceAreas: z.array(providerServiceAreaGroupSchema),
    verificationBadges: z.array(verificationTypeSchema),
    isVerified: z.boolean(),
    rating: z.object({ average: z.number(), count: z.number().int() }).nullable(),
    completedJobCount: z.number().int(),
    ustaScore: z.number().int().min(0).max(100).nullable(),
    isNewProvider: z.boolean(),
    memberSince: z.iso.datetime(),
  })
  .strict() satisfies z.ZodType<PublicProviderProfile>;

// --- Admin review -----------------------------------------------------------

export const listAdminProvidersQuerySchema = paginationQuerySchema.extend({
  /** The review queue by default. */
  status: providerStatusSchema.default('PENDING_REVIEW'),
});
export type ListAdminProvidersQuery = z.infer<typeof listAdminProvidersQuerySchema>;

export const listAdminVerificationsQuerySchema = paginationQuerySchema.extend({
  status: verificationStatusSchema.optional(),
  type: verificationTypeSchema.optional(),
});
export type ListAdminVerificationsQuery = z.infer<typeof listAdminVerificationsQuerySchema>;

/** A rejection or suspension always carries a reason the provider sees. */
export const reviewReasonRequestSchema = z
  .object({ reason: z.string().trim().min(5).max(1000) })
  .strict();
export type ReviewReasonRequest = z.infer<typeof reviewReasonRequestSchema>;

export const adminProviderListItemSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  displayName: z.string(),
  type: providerTypeSchema,
  status: providerStatusSchema,
  submittedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  contactName: z.string(),
  pendingVerifications: z.number().int(),
}) satisfies z.ZodType<AdminProviderListItem>;

export const adminProviderVerificationSchema = providerVerificationSchema.extend({
  providerId: z.uuid(),
  reviewedBy: namedRef.nullable(),
  hasDocument: z.boolean(),
}) satisfies z.ZodType<AdminProviderVerification>;

export const adminProviderDetailSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  displayName: z.string(),
  type: providerTypeSchema,
  status: providerStatusSchema,
  statusReason: z.string().nullable(),
  bio: z.string().nullable(),
  yearsOfExperience: z.number().int().nullable(),
  nowEnabled: z.boolean(),
  isAvailableNow: z.boolean(),
  submittedAt: z.iso.datetime().nullable(),
  reviewedAt: z.iso.datetime().nullable(),
  approvedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  contact: z.object({
    firstName: z.string(),
    lastName: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    phoneVerifiedAt: z.iso.datetime().nullable(),
  }),
  services: z.array(providerServiceItemSchema),
  serviceAreas: z.array(providerServiceAreaGroupSchema),
  verifications: z.array(adminProviderVerificationSchema),
  onboarding: providerOnboardingStatusSchema,
}) satisfies z.ZodType<AdminProviderDetail>;
