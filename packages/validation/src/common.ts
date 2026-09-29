import { z } from 'zod';

import { phoneSchema } from './phone.js';

export const uuidSchema = z.uuid();

/** Lowercased, trimmed e-mail address. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Geçerli bir e-posta adresi girin.' }).max(254));

/**
 * Kept for Phase 1 callers: mobile numbers of supported countries (today
 * only Türkiye) normalised to E.164. See phone.ts.
 */
export const turkishMobilePhoneSchema = phoneSchema;

export const personNameSchema = z.string().trim().min(1).max(80);

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.uuid().optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function paginatedSchema<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}
