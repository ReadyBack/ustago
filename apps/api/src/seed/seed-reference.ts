import type { PrismaClient } from '../generated/prisma/client.js';
import { CATEGORIES, DISTRICTS, PROVINCES } from './reference-data.js';
import { slugify } from './slugify.js';

export interface ReferenceSeedResult {
  provinces: number;
  districts: number;
  categories: number;
}

/**
 * Inserts provinces, districts and starting categories. Idempotent and safe
 * in every environment: existing rows are left untouched.
 */
export async function seedReferenceData(prisma: PrismaClient): Promise<ReferenceSeedResult> {
  const provinces = await prisma.province.createMany({
    data: PROVINCES.map(([id, name]) => ({ id, name, slug: slugify(name) })),
    skipDuplicates: true,
  });

  const districts = await prisma.district.createMany({
    data: Object.entries(DISTRICTS).flatMap(([provinceId, names]) =>
      names.map((name) => ({ provinceId: Number(provinceId), name, slug: slugify(name) })),
    ),
    skipDuplicates: true,
  });

  const categories = await prisma.serviceCategory.createMany({
    data: CATEGORIES.map((c, index) => ({
      slug: c.slug,
      name: c.name,
      icon: c.icon,
      supportsNow: c.supportsNow,
      supportsQuote: true,
      sortOrder: (index + 1) * 10,
    })),
    skipDuplicates: true,
  });

  return {
    provinces: provinces.count,
    districts: districts.count,
    categories: categories.count,
  };
}
