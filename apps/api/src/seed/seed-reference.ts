import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { DISTRICT_CENTERS, PROVINCE_CENTERS } from './data/turkey-coordinates.js';
import { CATEGORIES, DISTRICTS, PROVINCES } from './reference-data.js';
import { slugify } from './slugify.js';

export interface ReferenceSeedResult {
  provinces: number;
  districts: number;
  categories: number;
  coordinates: number;
}

const SOURCE: Record<'S' | 'M' | 'P', string> = {
  S: 'DISTRICT_SEAT',
  M: 'DISTRICT_AREA_MEAN',
  P: 'PROVINCE_CENTER',
};

/**
 * Fills approximate centres (docs/adr/0029) where they are still missing.
 * Rows an admin already corrected are never overwritten.
 */
async function seedCoordinates(prisma: PrismaClient): Promise<number> {
  const provinceRows = Object.entries(PROVINCE_CENTERS).map(
    ([id, [lat, lng]]) => Prisma.sql`(${Number(id)}::int, ${lat}::numeric, ${lng}::numeric)`,
  );
  const provinces = await prisma.$executeRaw`
    UPDATE provinces p SET latitude = v.lat, longitude = v.lng
    FROM (VALUES ${Prisma.join(provinceRows)}) AS v(id, lat, lng)
    WHERE p.id = v.id AND p.latitude IS NULL`;

  const districtRows = Object.entries(DISTRICT_CENTERS).flatMap(([provinceId, byName]) =>
    Object.entries(byName).map(
      ([name, [lat, lng, src]]) =>
        Prisma.sql`(${Number(provinceId)}::int, ${name}::text, ${lat}::numeric, ${lng}::numeric, ${SOURCE[src]}::text)`,
    ),
  );
  let districts = 0;
  for (let i = 0; i < districtRows.length; i += 250) {
    districts += await prisma.$executeRaw`
      UPDATE districts d
      SET latitude = v.lat, longitude = v.lng, coordinate_source = v.src
      FROM (VALUES ${Prisma.join(districtRows.slice(i, i + 250))}) AS v(pid, name, lat, lng, src)
      WHERE d.province_id = v.pid AND d.name = v.name AND d.latitude IS NULL`;
  }

  // Requests created before Faz 7 get their district centre as the approximate point.
  await prisma.$executeRaw`
    UPDATE service_requests r
    SET approx_latitude = round(d.latitude, 4), approx_longitude = round(d.longitude, 4)
    FROM districts d
    WHERE r.district_id = d.id AND r.approx_latitude IS NULL AND d.latitude IS NOT NULL`;
  return provinces + districts;
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

  const coordinates = await seedCoordinates(prisma);

  return {
    coordinates,
    provinces: provinces.count,
    districts: districts.count,
    categories: categories.count,
  };
}
