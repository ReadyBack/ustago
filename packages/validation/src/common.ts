import { z } from 'zod';

export const uuidSchema = z.uuid();

/** Lowercased, trimmed e-mail address. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Geçerli bir e-posta adresi girin.' }).max(254));

/**
 * Turkish mobile numbers normalised to E.164 (+905XXXXXXXXX). Accepts
 * "05321234567", "5321234567", "+90 532 123 45 67".
 */
export const turkishMobilePhoneSchema = z
  .string()
  .transform((value) => value.replace(/[\s()-]/g, ''))
  .transform((value) => {
    if (value.startsWith('+90')) return value;
    if (value.startsWith('0')) return `+9${value}`;
    if (value.startsWith('5')) return `+90${value}`;
    return value;
  })
  .pipe(z.string().regex(/^\+905\d{9}$/, 'Geçerli bir cep telefonu numarası girin.'));

export const personNameSchema = z.string().trim().min(1).max(80);

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.uuid().optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function paginatedSchema<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}
