import type { Address } from '@ustago/types';
import { z } from 'zod';

const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();

export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

const addressFields = {
  label: optionalText(40),
  provinceId: z.number().int().min(1).max(81),
  districtId: z.uuid(),
  neighborhood: optionalText(120),
  addressLine: z.string().trim().min(5).max(300),
  buildingNo: optionalText(20),
  apartmentNo: optionalText(20),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{5}$/, 'Posta kodu 5 haneli olmalı.')
    .nullable()
    .optional(),
  instructions: optionalText(500),
  latitude: latitudeSchema.nullable().optional(),
  longitude: longitudeSchema.nullable().optional(),
};

/** Coordinates are optional but come as a pair. */
function coordinatesPaired(value: { latitude?: number | null; longitude?: number | null }) {
  return (value.latitude ?? null) === null
    ? (value.longitude ?? null) === null
    : value.longitude !== null && value.longitude !== undefined;
}
const PAIR_ERROR = { path: ['longitude'], message: 'Enlem ve boylam birlikte gönderilmeli.' };

export const createAddressRequestSchema = z
  .object({ ...addressFields, isDefault: z.boolean().optional() })
  .strict()
  .refine(coordinatesPaired, PAIR_ERROR);
export type CreateAddressRequest = z.infer<typeof createAddressRequestSchema>;

export const updateAddressRequestSchema = z
  .object({
    ...addressFields,
    provinceId: addressFields.provinceId.optional(),
    districtId: addressFields.districtId.optional(),
    addressLine: addressFields.addressLine.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'En az bir alan gönderin.' })
  .refine(
    (value) => 'latitude' in value === 'longitude' in value && coordinatesPaired(value),
    PAIR_ERROR,
  )
  .refine((value) => (value.provinceId === undefined) === (value.districtId === undefined), {
    path: ['districtId'],
    message: 'İl ve ilçe birlikte değiştirilmeli.',
  });
export type UpdateAddressRequest = z.infer<typeof updateAddressRequestSchema>;

export const addressSchema = z.object({
  id: z.uuid(),
  label: z.string().nullable(),
  province: z.object({ id: z.number().int(), name: z.string() }),
  district: z.object({ id: z.uuid(), name: z.string() }),
  neighborhood: z.string().nullable(),
  addressLine: z.string(),
  buildingNo: z.string().nullable(),
  apartmentNo: z.string().nullable(),
  postalCode: z.string().nullable(),
  instructions: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  isDefault: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}) satisfies z.ZodType<Address>;
