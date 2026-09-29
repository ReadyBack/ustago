import type { District, Province, ServiceCategory } from '@ustago/types';
import { z } from 'zod';

const slugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug küçük harf, rakam ve tire içerebilir.')
  .max(80);

export const serviceCategorySchema = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  supportsNow: z.boolean(),
  supportsQuote: z.boolean(),
}) satisfies z.ZodType<ServiceCategory>;

export const createCategoryRequestSchema = z
  .object({
    slug: slugSchema,
    name: z.string().trim().min(2).max(80),
    parentId: z.uuid().optional(),
    description: z.string().trim().max(500).optional(),
    icon: z.string().trim().max(60).optional(),
    sortOrder: z.number().int().min(0).max(10000).default(0),
    isActive: z.boolean().default(true),
    supportsNow: z.boolean().default(false),
    supportsQuote: z.boolean().default(true),
  })
  .strict();
export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>;

export const updateCategoryRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    icon: z.string().trim().max(60).nullable().optional(),
    sortOrder: z.number().int().min(0).max(10000).optional(),
    isActive: z.boolean().optional(),
    supportsNow: z.boolean().optional(),
    supportsQuote: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'En az bir alan gönderin.' });
export type UpdateCategoryRequest = z.infer<typeof updateCategoryRequestSchema>;

export const provinceSchema = z.object({
  id: z.number().int().min(1).max(81),
  name: z.string(),
  slug: z.string(),
  isActive: z.boolean(),
}) satisfies z.ZodType<Province>;

export const districtSchema = z.object({
  id: z.uuid(),
  provinceId: z.number().int(),
  name: z.string(),
  slug: z.string(),
  isActive: z.boolean(),
}) satisfies z.ZodType<District>;

export const provinceIdParamSchema = z.coerce.number().int().min(1).max(81);

export const listProvincesQuerySchema = z.object({
  active: z.enum(['true', 'false']).optional(),
});

export const updateProvinceRequestSchema = z.object({ isActive: z.boolean() }).strict();
export type UpdateProvinceRequest = z.infer<typeof updateProvinceRequestSchema>;
