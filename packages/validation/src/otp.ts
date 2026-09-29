import type { OtpPurpose, OtpRequestResponse, OtpVerifyResponse } from '@ustago/types';
import { z } from 'zod';

import { authTokensSchema, currentUserSchema } from './auth.js';
import { personNameSchema } from './common.js';
import { phoneSchema } from './phone.js';

export const otpPurposeSchema = z.enum([
  'REGISTER_OR_LOGIN',
  'VERIFY_PHONE',
]) satisfies z.ZodType<OtpPurpose>;

export const otpRequestSchema = z
  .object({
    phone: phoneSchema,
    purpose: otpPurposeSchema.default('REGISTER_OR_LOGIN'),
  })
  .strict();
export type OtpRequest = z.infer<typeof otpRequestSchema>;

/** Digits only; the length is checked against OTP_CODE_LENGTH by the API. */
export const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{4,8}$/, 'Kod yalnızca rakamlardan oluşmalı.');

export const otpVerifySchema = z
  .object({
    phone: phoneSchema,
    purpose: otpPurposeSchema.default('REGISTER_OR_LOGIN'),
    code: otpCodeSchema,
    /** Used only when the verification creates a new account. */
    firstName: personNameSchema.optional(),
    lastName: personNameSchema.optional(),
  })
  .strict();
export type OtpVerifyRequest = z.infer<typeof otpVerifySchema>;

export const otpRequestResponseSchema = z.object({
  phone: z.string(),
  purpose: otpPurposeSchema,
  codeLength: z.number().int(),
  expiresAt: z.iso.datetime(),
  resendAvailableAt: z.iso.datetime(),
}) satisfies z.ZodType<OtpRequestResponse>;

export const otpVerifyResponseSchema = z.object({
  user: currentUserSchema,
  tokens: authTokensSchema.nullable(),
  isNewUser: z.boolean(),
}) satisfies z.ZodType<OtpVerifyResponse>;
