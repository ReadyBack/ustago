import type { District, Province, ProvinceCategorySetting, ServiceCategory } from '@ustago/types';
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
    /** Faz 7: how the request wizard treats photos for this category. */
    requestPhotoPolicy: z.enum(['OPTIONAL', 'RECOMMENDED', 'REQUIRED']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'En az bir alan gönderin.' });
export type UpdateCategoryRequest = z.infer<typeof updateCategoryRequestSchema>;

export const provinceSchema = z.object({
  id: z.number().int().min(1).max(81),
  name: z.string(),
  slug: z.string(),
  isActive: z.boolean(),
  launchStatus: z.enum(['ACTIVE', 'WAITLIST', 'DISABLED']),
  countryCode: z.string().length(2),
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

/**
 * Province launch control (Faz 7, docs/adr/0029). `isActive` opens the
 * marketplace; while closed, `waitlistOpen` decides WAITLIST (requests are
 * accepted and wait for supply) or DISABLED. Provinces are reference data
 * and can never be deleted.
 */
export const updateProvinceRequestSchema = z
  .object({ isActive: z.boolean().optional(), waitlistOpen: z.boolean().optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'En az bir alan gönderin.' });
export type UpdateProvinceRequest = z.infer<typeof updateProvinceRequestSchema>;

export const listDistrictsQuerySchema = z.object({
  /** Admins can include districts that are switched off. */
  includeInactive: z.enum(['true', 'false']).optional(),
});

export const provinceCategorySettingSchema = z.object({
  provinceId: z.number().int(),
  category: z.object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    supportsNow: z.boolean(),
  }),
  isActive: z.boolean(),
  nowEnabled: z.boolean(),
  source: z.enum(['DEFAULT', 'OVERRIDE']),
}) satisfies z.ZodType<ProvinceCategorySetting>;

/** Admin switch for a category in one province ("Adana: Klima açık, NOW açık"). */
export const updateProvinceCategoryRequestSchema = z
  .object({ isActive: z.boolean(), nowEnabled: z.boolean() })
  .strict()
  .refine((value) => value.isActive || !value.nowEnabled, {
    path: ['nowEnabled'],
    message: 'Kapalı bir kategoride NOW açılamaz.',
  });
export type UpdateProvinceCategoryRequest = z.infer<typeof updateProvinceCategoryRequestSchema>;
