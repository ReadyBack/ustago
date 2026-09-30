import { Injectable } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client.js';
import {
  type CandidateRow,
  candidateFeatures,
  haversineSql,
  PROVIDER_JOIN,
} from '../matching/matching.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface DiscoveryFilter {
  categoryId?: string;
  /** Customer's district: coverage and distance are measured from its centre. */
  districtId?: string;
  provinceId?: number;
  limit: number;
}

const TD_LAT = Prisma.sql`td.latitude`;
const TD_LNG = Prisma.sql`td.longitude`;

/**
 * Customer-facing provider discovery (docs/adr/0028): publicly listed
 * providers (ACTIVE application, account ACTIVE/LIMITED, no job
 * restriction) offering the category and covering the customer's district
 * the same way request matching does (district, province, radius, travel
 * limit). Returns the MATCH_V1 signals so "Önerilen" uses the same score.
 */
@Injectable()
export class DiscoveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async candidates(filter: DiscoveryFilter): Promise<CandidateRow[]> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`pr.status = 'ACTIVE' AND pr.deleted_at IS NULL
        AND pr.account_status IN ('ACTIVE', 'LIMITED')
        AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM disciplinary_actions da
                        WHERE da.subject_id = pr.user_id AND da.subject_role = 'PROVIDER'
                          AND da.type = 'JOB_RESTRICTION' AND da.status IN ('ACTIVE', 'UNDER_APPEAL')
                          AND da.starts_at <= now() AND (da.ends_at IS NULL OR da.ends_at > now()))`,
    ];
    if (filter.categoryId) {
      conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM provider_services s
        JOIN service_categories c ON c.id = s.category_id
        WHERE s.provider_id = pr.id AND s.category_id = ${filter.categoryId}::uuid AND c.is_active)`);
    }
    const distance = Prisma.sql`CASE WHEN scd.latitude IS NULL OR td.latitude IS NULL THEN NULL
      ELSE ${haversineSql(Prisma.sql`scd.latitude`, Prisma.sql`scd.longitude`, TD_LAT, TD_LNG)} END`;
    if (filter.districtId) {
      conditions.push(Prisma.sql`
        (EXISTS (SELECT 1 FROM provider_service_areas pa
                 WHERE pa.provider_id = pr.id AND pa.district_id = td.id)
         OR EXISTS (SELECT 1 FROM provider_service_regions rg
                    WHERE rg.provider_id = pr.id AND rg.active AND rg.kind = 'PROVINCE'
                      AND rg.province_id = td.province_id)
         OR EXISTS (SELECT 1 FROM provider_service_regions rg
                    WHERE rg.provider_id = pr.id AND rg.active AND rg.kind = 'RADIUS'
                      AND td.latitude IS NOT NULL
                      AND ${haversineSql(Prisma.sql`rg.center_lat`, Prisma.sql`rg.center_lng`, TD_LAT, TD_LNG)}
                          <= rg.radius_km))
        AND (pr.max_travel_km IS NULL OR scd.latitude IS NULL OR td.latitude IS NULL
             OR ${haversineSql(Prisma.sql`scd.latitude`, Prisma.sql`scd.longitude`, TD_LAT, TD_LNG)}
                <= pr.max_travel_km)`);
    } else if (filter.provinceId) {
      conditions.push(Prisma.sql`
        (EXISTS (SELECT 1 FROM provider_service_areas pa JOIN districts d2 ON d2.id = pa.district_id
                 WHERE pa.provider_id = pr.id AND d2.province_id = ${filter.provinceId})
         OR EXISTS (SELECT 1 FROM provider_service_regions rg
                    WHERE rg.provider_id = pr.id AND rg.active AND rg.province_id = ${filter.provinceId}))`);
    }
    const areaFit = filter.districtId
      ? Prisma.sql`CASE WHEN EXISTS (SELECT 1 FROM provider_service_areas pa
                        WHERE pa.provider_id = pr.id AND pa.district_id = td.id)
                   THEN 'DISTRICT' ELSE 'REGION' END`
      : Prisma.sql`'REGION'`;
    return this.prisma.$queryRaw<CandidateRow[]>`
      SELECT ${candidateFeatures(areaFit, distance)}
      FROM provider_profiles pr
      JOIN users u ON u.id = pr.user_id
      ${PROVIDER_JOIN}
      LEFT JOIN districts td ON td.id = ${filter.districtId ?? null}::uuid
      LEFT JOIN provider_scores ps ON ps.provider_id = pr.id
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY ps.score DESC NULLS LAST, pr.id
      LIMIT ${filter.limit}`;
  }
}
