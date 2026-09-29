import type { ProviderProfile } from '@ustago/types';
import { z } from 'zod';

import { providerStatusSchema, providerTypeSchema } from './auth.js';

export const createProviderProfileRequestSchema = z
  .object({
    displayName: z.string().trim().min(2).max(120),
    type: providerTypeSchema.default('INDIVIDUAL'),
    bio: z.string().trim().max(2000).optional(),
    yearsOfExperience: z.number().int().min(0).max(70).optional(),
  })
  .strict();
export type CreateProviderProfileRequest = z.infer<typeof createProviderProfileRequestSchema>;

export const updateProviderProfileRequestSchema = z
  .object({
    displayName: z.string().trim().min(2).max(120).optional(),
    type: providerTypeSchema.optional(),
    bio: z.string().trim().max(2000).nullable().optional(),
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
  approvedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}) satisfies z.ZodType<ProviderProfile>;
