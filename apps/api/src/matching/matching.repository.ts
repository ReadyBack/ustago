import { Injectable } from '@nestjs/common';

import { Prisma, type ServiceRequestType } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

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
 */
const ELIGIBLE = Prisma.sql`
  pr.status = 'ACTIVE' AND pr.deleted_at IS NULL
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
  AND (
    (sr.type = 'QUOTE' AND c.supports_quote)
    OR (sr.type = 'NOW' AND c.supports_now
        AND pr.now_enabled AND pr.is_available_now
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
   * the country (PROJECT.md §6.3).
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
      WHERE sr.id = ${requestId}::uuid AND ${ELIGIBLE}
      ORDER BY pr.approved_at ASC NULLS LAST, pr.id
      LIMIT ${limit}`;
  }
}
