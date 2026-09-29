import type {
  AuthResponse,
  AuthTokens,
  CurrentUser,
  ProviderProfileSummary,
  Role,
} from '@ustago/types';
import { z } from 'zod';

import { emailSchema, personNameSchema, turkishMobilePhoneSchema } from './common.js';

export const roleSchema = z.enum([
  'CUSTOMER',
  'PROVIDER',
  'ADMIN',
  'SUPER_ADMIN',
]) satisfies z.ZodType<Role>;
export const userStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'BANNED']);
export const providerStatusSchema = z.enum([
  'DRAFT',
  'PENDING_REVIEW',
  'ACTIVE',
  'SUSPENDED',
  'REJECTED',
]);
export const providerTypeSchema = z.enum(['INDIVIDUAL', 'COMPANY']);

/**
 * 10-128 characters, no composition rules (NIST SP 800-63B). The upper bound
 * keeps hashing cost bounded.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Şifre en az 10 karakter olmalı.')
  .max(128, 'Şifre en fazla 128 karakter olabilir.');

/** Public sign-up can only create customer or provider accounts. */
export const registerAccountTypeSchema = z.enum(['CUSTOMER', 'PROVIDER']);

export const registerRequestSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    firstName: personNameSchema,
    lastName: personNameSchema,
    phone: turkishMobilePhoneSchema.optional(),
    accountType: registerAccountTypeSchema.default('CUSTOMER'),
    /** Provider display name; defaults to "First Last". */
    providerDisplayName: z.string().trim().min(2).max(120).optional(),
  })
  .strict()
  .refine((value) => value.password.toLowerCase() !== value.email, {
    path: ['password'],
    message: 'Şifre e-posta adresiyle aynı olamaz.',
  });
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z
  .object({
    email: emailSchema,
    // Only bounded here: login must not reveal the password policy.
    password: z.string().min(1).max(128),
  })
  .strict();
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const refreshRequestSchema = z
  .object({ refreshToken: z.string().min(20).max(200) })
  .strict();
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const authTokensSchema = z.object({
  tokenType: z.literal('Bearer'),
  accessToken: z.string().min(1),
  accessTokenExpiresAt: z.iso.datetime(),
  refreshToken: z.string().min(1),
  refreshTokenExpiresAt: z.iso.datetime(),
}) satisfies z.ZodType<AuthTokens>;

export const providerProfileSummarySchema = z.object({
  id: z.uuid(),
  status: providerStatusSchema,
  displayName: z.string(),
}) satisfies z.ZodType<ProviderProfileSummary>;

export const currentUserSchema = z.object({
  id: z.uuid(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  firstName: z.string(),
  lastName: z.string(),
  status: userStatusSchema,
  locale: z.string(),
  roles: z.array(roleSchema),
  emailVerifiedAt: z.iso.datetime().nullable(),
  phoneVerifiedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  customerProfile: z.object({ id: z.uuid() }).nullable(),
  providerProfile: providerProfileSummarySchema.nullable(),
}) satisfies z.ZodType<CurrentUser>;

export const authResponseSchema = z.object({
  user: currentUserSchema,
  tokens: authTokensSchema,
}) satisfies z.ZodType<AuthResponse>;
