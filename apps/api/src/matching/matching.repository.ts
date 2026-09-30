import { Injectable } from '@nestjs/common';

import { Prisma, type ServiceRequestType } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NEW_PROVIDER_RANKING_SCORE } from '../quality/domain/usta-score.js';

type Db = Prisma.TransactionClient | PrismaService;

/**
 * The opportunity matching query (docs/adr/0014). One SQL predicate decides
 * whether provider `pr` may see request `sr`; the pure mirror of these
 * rules is `domain/eligibility.ts`. Everything is checked live on every
 * call:
 *
 * - provider ACTIVE, serves the category and the request's district;
 * - request open (PUBLISHED / MATCHING / QUOTED) and not expired;
 * - customer account ACTIVE and not the provider themself;
 * - category (and parent) active, province and district active, and the
 *   province × category row (if any) not switched off;
 * - QUOTE: category supports quotes;
 * - NOW: category supports NOW, provider `now_enabled` AND
 *   `is_available_now`, and the province × category row (if any) has NOW
 *   enabled. The flag on the provider is never trusted alone.
 * - admin sanctions in force (docs/adr/0016): JOB_RESTRICTION hides every
 *   new request, NOW_SUSPENSION hides NOW requests.
 */
/**
 * Mirrors matching/domain/eligibility.ts and providers/domain/provider-policy.ts.
 * Faz 6: suspended/banned accounts see nothing; NOW needs a VERIFIED case
 * and an ACTIVE account; a category's admin-configured document
 * requirements (also those of its parent) must be approved.
 */
const ELIGIBLE = Prisma.sql`
  pr.status = 'ACTIVE' AND pr.deleted_at IS NULL
  AND pr.account_status IN ('ACTIVE', 'LIMITED')
  AND sr.status IN ('PUBLISHED', 'MATCHING', 'QUOTED')
  AND (sr.expires_at IS NULL OR sr.expires_at > now())
  AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
  AND u.id <> pr.user_id
  AND c.is_active AND (pc.id IS NULL OR pc.is_active)
  AND p.is_active AND d.is_active
  AND (ov.province_id IS NULL OR ov.is_active)
  AND EXISTS (SELECT 1 FROM provider_services ps
              WHERE ps.provider_id = pr.id AND ps.category_id = sr.category_id)
  AND EXISTS (SELECT 1 FROM provider_service_areas pa
              WHERE pa.provider_id = pr.id AND pa.district_id = sr.district_id)
  AND NOT EXISTS (SELECT 1 FROM category_provider_requirements r
                  WHERE r.deactivated_at IS NULL
                    AND (r.category_id = sr.category_id OR r.category_id = c.parent_id)
                    AND NOT EXISTS (SELECT 1 FROM provider_verifications v
                                    WHERE v.provider_id = pr.id AND v.type = r.document_type
                                      AND v.status = 'APPROVED'))
  AND NOT EXISTS (SELECT 1 FROM disciplinary_actions da
                  WHERE da.subject_id = pr.user_id AND da.subject_role = 'PROVIDER'
                    AND da.status IN ('ACTIVE', 'UNDER_APPEAL')
                    AND da.starts_at <= now() AND (da.ends_at IS NULL OR da.ends_at > now())
                    AND (da.type = 'JOB_RESTRICTION'
                         OR (da.type = 'NOW_SUSPENSION' AND sr.type = 'NOW')))
  AND (
    (sr.type = 'QUOTE' AND c.supports_quote)
    OR (sr.type = 'NOW' AND c.supports_now
        AND pr.now_enabled AND pr.is_available_now
        AND pr.account_status = 'ACTIVE'
        AND EXISTS (SELECT 1 FROM provider_verification_cases vc
                    WHERE vc.provider_id = pr.id AND vc.status = 'VERIFIED')
        AND (ov.province_id IS NULL OR ov.now_enabled))
  )`;

const JOINS = Prisma.sql`
  JOIN service_categories c ON c.id = sr.category_id
  LEFT JOIN service_categories pc ON pc.id = c.parent_id
  JOIN provinces p ON p.id = sr.province_id
  JOIN districts d ON d.id = sr.district_id
  JOIN customer_profiles cp ON cp.id = sr.customer_id
  JOIN users u ON u.id = cp.user_id
  LEFT JOIN province_categories ov
    ON ov.province_id = sr.province_id AND ov.category_id = sr.category_id`;

export interface OpportunityFilter {
  type?: ServiceRequestType;
  categoryId?: string;
  /** Page after this request id (ids are UUIDv7, so newest first). */
  cursor?: string;
  limit: number;
}

@Injectable()
export class MatchingRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Requests the provider may quote on and has not quoted yet, newest first. */
  async opportunityIds(providerId: string, filter: OpportunityFilter): Promise<string[]> {
    const conditions: Prisma.Sql[] = [ELIGIBLE];
    conditions.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM quotes q
      WHERE q.service_request_id = sr.id AND q.provider_id = pr.id)`);
    if (filter.type) conditions.push(Prisma.sql`sr.type = ${filter.type}::"ServiceRequestType"`);
    if (filter.categoryId) conditions.push(Prisma.sql`sr.category_id = ${filter.categoryId}::uuid`);
    if (filter.cursor) conditions.push(Prisma.sql`sr.id < ${filter.cursor}::uuid`);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT sr.id FROM service_requests sr
      ${JOINS}
      JOIN provider_profiles pr ON pr.id = ${providerId}::uuid
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY sr.id DESC
      LIMIT ${filter.limit}`;
    return rows.map((r) => r.id);
  }

  /** Re-checks one pair; used before showing a detail page or taking a quote. */
  async isEligible(db: Db, providerId: string, requestId: string): Promise<boolean> {
    const rows = await db.$queryRaw<{ ok: number }[]>`
      SELECT 1 AS ok FROM service_requests sr
      ${JOINS}
      JOIN provider_profiles pr ON pr.id = ${providerId}::uuid
      WHERE sr.id = ${requestId}::uuid AND ${ELIGIBLE}`;
    return rows.length > 0;
  }

  /**
   * Providers who can take a request right now (for NOW dispatch and "new
   * job nearby" notifications). Bounded: one wave, not every provider in
   * the country (PROJECT.md §6.3). Ordered by the ranking score
   * (docs/adr/0016): eligibility above decides who may take the job at
   * all, the score only who hears first; new providers rank at a neutral
   * score so they are neither buried nor boosted.
   */
  async eligibleProviders(
    db: Db,
    requestId: string,
    limit: number,
  ): Promise<{ id: string; userId: string }[]> {
    return db.$queryRaw<{ id: string; userId: string }[]>`
      SELECT pr.id, pr.user_id AS "userId" FROM service_requests sr
      ${JOINS}
      CROSS JOIN provider_profiles pr
      LEFT JOIN provider_scores ps ON ps.provider_id = pr.id
      WHERE sr.id = ${requestId}::uuid AND ${ELIGIBLE}
      ORDER BY (CASE WHEN ps.provider_id IS NULL OR ps.is_new_provider
                     THEN ${NEW_PROVIDER_RANKING_SCORE}::numeric ELSE ps.score END) DESC,
               pr.approved_at ASC NULLS LAST, pr.id
      LIMIT ${limit}`;
  }
}
