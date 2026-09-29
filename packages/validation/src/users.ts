import type { Device } from '@ustago/types';
import { z } from 'zod';

import { roleSchema, userStatusSchema } from './auth.js';
import { paginationQuerySchema, personNameSchema } from './common.js';

export const updateMeRequestSchema = z
  .object({
    firstName: personNameSchema.optional(),
    lastName: personNameSchema.optional(),
    locale: z.enum(['tr-TR', 'en-US']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'En az bir alan gönderin.' });
export type UpdateMeRequest = z.infer<typeof updateMeRequestSchema>;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  role: roleSchema.optional(),
  status: userStatusSchema.optional(),
  /** Case-insensitive match on e-mail, phone or name. */
  q: z.string().trim().min(2).max(100).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const updateUserStatusRequestSchema = z
  .object({
    status: userStatusSchema,
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export type UpdateUserStatusRequest = z.infer<typeof updateUserStatusRequestSchema>;

/** Only staff roles are granted by hand; PROVIDER comes from onboarding. */
export const staffRoleSchema = z.enum(['ADMIN', 'SUPER_ADMIN']);
export type StaffRole = z.infer<typeof staffRoleSchema>;

export const registerDeviceRequestSchema = z
  .object({
    platform: z.enum(['IOS', 'ANDROID', 'WEB']),
    pushProvider: z.enum(['EXPO', 'FCM', 'APNS']).optional(),
    pushToken: z.string().trim().min(10).max(512).optional(),
    deviceName: z.string().trim().max(120).optional(),
    appVersion: z.string().trim().max(40).optional(),
  })
  .strict()
  .refine((value) => (value.pushToken === undefined) === (value.pushProvider === undefined), {
    path: ['pushProvider'],
    message: 'pushToken ve pushProvider birlikte gönderilmeli.',
  });
export type RegisterDeviceRequest = z.infer<typeof registerDeviceRequestSchema>;

export const deviceSchema = z.object({
  id: z.uuid(),
  platform: z.enum(['IOS', 'ANDROID', 'WEB']),
  pushProvider: z.enum(['EXPO', 'FCM', 'APNS']).nullable(),
  deviceName: z.string().nullable(),
  appVersion: z.string().nullable(),
  lastSeenAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
}) satisfies z.ZodType<Device>;
