import { Inject, Injectable } from '@nestjs/common';
import type { ApiEnv } from '@ustago/config';

import { Prisma, type ServiceRequestType } from '../generated/prisma/client.js';
import { API_ENV } from '../config/env.js';
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
 * - admin sanctions in force (docs/adr/0016): JOB_RESTRICTION hides every
 *   new request, NOW_SUSPENSION hides NOW requests.
 */
/**
 * Mirrors matching/domain/eligibility.ts and providers/domain/provider-policy.ts.
 * Faz 6: suspended/banned accounts see nothing; NOW needs a VERIFIED case
 * and an ACTIVE account; a category's admin-configured document
 * requirements (also those of its parent) must be approved.
 */
/** Great-circle km between two lat/lng SQL expressions (docs/adr/0029). */
export function haversineSql(
  lat1: Prisma.Sql,
  lng1: Prisma.Sql,
  lat2: Prisma.Sql,
  lng2: Prisma.Sql,
): Prisma.Sql {
  return Prisma.sql`(2 * 6371.0088 * asin(least(1, sqrt(
    power(sin(radians((${lat2})::float8 - (${lat1})::float8) / 2), 2)
    + cos(radians((${lat1})::float8)) * cos(radians((${lat2})::float8))
      * power(sin(radians((${lng2})::float8 - (${lng1})::float8) / 2), 2)))))`;
}

/** The request's approximate point: coarse address point, else district centre. */
export const REQUEST_LAT = Prisma.sql`COALESCE(sr.approx_latitude, d.latitude)`;
export const REQUEST_LNG = Prisma.sql`COALESCE(sr.approx_longitude, d.longitude)`;
/** Provider service centre (a district centre, never a home address). */
export const CENTER_LAT = Prisma.sql`scd.latitude`;
export const CENTER_LNG = Prisma.sql`scd.longitude`;
export const DISTANCE_KM = Prisma.sql`CASE WHEN scd.latitude IS NULL OR ${REQUEST_LAT} IS NULL THEN NULL
  ELSE ${haversineSql(CENTER_LAT, CENTER_LNG, REQUEST_LAT, REQUEST_LNG)} END`;

/**
 * Faz 7 coverage (docs/adr/0029): a single district (Faz 2), a whole
 * province, or a radius around a centre district; then the provider's own
 * maximum travel distance from the service centre, when both are set.
 */
const COVERAGE = Prisma.sql`
  (EXISTS (SELECT 1 FROM provider_service_areas pa
           WHERE pa.provider_id = pr.id AND pa.district_id = sr.district_id)
   OR EXISTS (SELECT 1 FROM provider_service_regions rg
              WHERE rg.provider_id = pr.id AND rg.active AND rg.kind = 'PROVINCE'
                AND rg.province_id = sr.province_id)
   OR EXISTS (SELECT 1 FROM provider_service_regions rg
              WHERE rg.provider_id = pr.id AND rg.active AND rg.kind = 'RADIUS'
                AND ${REQUEST_LAT} IS NOT NULL
                AND ${haversineSql(Prisma.sql`rg.center_lat`, Prisma.sql`rg.center_lng`, REQUEST_LAT, REQUEST_LNG)}
                    <= rg.radius_km))
  AND (pr.max_travel_km IS NULL OR scd.latitude IS NULL OR ${REQUEST_LAT} IS NULL
       OR ${haversineSql(CENTER_LAT, CENTER_LNG, REQUEST_LAT, REQUEST_LNG)} <= pr.max_travel_km)`;

/**
 * Faz 7 availability (docs/adr/0031), mirrored by providers/domain/availability.ts:
 * "Yeni iş alma", "Bugün müsait değilim" and time off stop new work; NOW
 * additionally needs the provider inside weekly hours (none set = flexible).
 */
function availabilitySql(timeZone: string): Prisma.Sql {
  return Prisma.sql`
  pr.accepting_new_jobs
  AND (pr.unavailable_until IS NULL OR pr.unavailable_until <= now())
  AND NOT EXISTS (SELECT 1 FROM provider_time_off t
                  WHERE t.provider_id = pr.id AND t.cancelled_at IS NULL
                    AND t.starts_at <= now() AND t.ends_at > now())
  AND (sr.type <> 'NOW'
       OR NOT EXISTS (SELECT 1 FROM provider_weekly_hours wh WHERE wh.provider_id = pr.id)
       OR EXISTS (SELECT 1 FROM provider_weekly_hours wh
                  WHERE wh.provider_id = pr.id
                    AND wh.weekday = extract(isodow FROM now() AT TIME ZONE ${timeZone})::int
                    AND wh.start_minute <= (extract(hour FROM now() AT TIME ZONE ${timeZone}) * 60
                                            + extract(minute FROM now() AT TIME ZONE ${timeZone}))::int
                    AND wh.end_minute > (extract(hour FROM now() AT TIME ZONE ${timeZone}) * 60
                                         + extract(minute FROM now() AT TIME ZONE ${timeZone}))::int))`;
}

/** "Sadece bu ustaya gönder" and chat blocks between the two users. */
const PREFERENCE_AND_BLOCKS = Prisma.sql`
  (NOT sr.preferred_only OR sr.preferred_provider_id IS NULL OR sr.preferred_provider_id = pr.id)
  AND NOT EXISTS (SELECT 1 FROM user_blocks ub
                  WHERE (ub.blocker_id = u.id AND ub.blocked_id = pr.user_id)
                     OR (ub.blocker_id = pr.user_id AND ub.blocked_id = u.id))`;

const BASE_ELIGIBLE = Prisma.sql`
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
  AND ${COVERAGE}
  AND ${PREFERENCE_AND_BLOCKS}
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

/** Provider-side joins every eligibility query needs (service centre). */
const PROVIDER_JOIN = Prisma.sql`LEFT JOIN districts scd ON scd.id = pr.service_center_district_id`;

export type OpportunitySort = 'NEW' | 'NEAREST' | 'BUDGET';

export interface OpportunityFilter {
  type?: ServiceRequestType;
  categoryId?: string;
  sort?: OpportunitySort;
  maxDistanceKm?: number;
  /** Only requests dispatched to this provider (docs/adr/0028). */
  dispatchedOnly?: boolean;
  /** Opaque keyset cursor from the previous page. */
  cursor?: string;
  limit: number;
}

export interface OpportunityRef {
  id: string;
  distanceKm: number | null;
}

/** Everything MATCH_V1 needs about one eligible provider, in one query. */
export interface CandidateRow {
  id: string;
  userId: string;
  areaFit: 'DISTRICT' | 'REGION';
  distanceKm: number | null;
  acceptingNewJobs: boolean;
  unavailableUntil: Date | null;
  score: number | null;
  isNewProvider: boolean | null;
  completedJobs: number;
  providerCancelledJobs: number;
  attributableJobs: number;
  lastActiveAt: Date | null;
  approvedAt: Date | null;
  verified: boolean;
  accountLimited: boolean;
  visibilityReduced: boolean;
  activeWarnings: number;
}

interface CursorKey {
  k: number;
  id: string;
}

export function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): CursorKey | null {
  if (!cursor) return null;
  // A bare request id is the Faz 2 cursor (newest first).
  if (/^[0-9a-f-]{36}$/i.test(cursor)) return { k: 0, id: cursor };
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<CursorKey>;
    if (typeof v.k === 'number' && typeof v.id === 'string' && /^[0-9a-f-]{36}$/i.test(v.id)) {
      return { k: v.k, id: v.id };
    }
  } catch {
    // fall through
  }
  return null;
}

/** Sort keys with nulls mapped to sentinels, so keyset pagination stays total. */
const NEAREST_KEY = Prisma.sql`COALESCE(${DISTANCE_KM}, 1000000)`;
const BUDGET_KEY = Prisma.sql`COALESCE(sr.budget_max_minor, sr.budget_minor, -1)::float8`;

@Injectable()
export class MatchingRepository {
  private readonly eligible: Prisma.Sql;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.eligible = Prisma.sql`${BASE_ELIGIBLE} AND ${availabilitySql(env.MARKETPLACE_TIME_ZONE)}`;
  }

  /**
   * Requests the provider may quote on and has not quoted yet. NEW is
   * newest first; NEAREST and BUDGET use a keyset (sort key, id) so pages
   * never skip or repeat rows.
   */
  async opportunities(
    providerId: string,
    filter: OpportunityFilter,
  ): Promise<{ items: OpportunityRef[]; nextCursor: string | null }> {
    const sort = filter.sort ?? 'NEW';
    const conditions: Prisma.Sql[] = [this.eligible];
    conditions.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM quotes q
      WHERE q.service_request_id = sr.id AND q.provider_id = pr.id)`);
    if (filter.type) conditions.push(Prisma.sql`sr.type = ${filter.type}::"ServiceRequestType"`);
    if (filter.categoryId) conditions.push(Prisma.sql`sr.category_id = ${filter.categoryId}::uuid`);
    if (filter.maxDistanceKm !== undefined) {
      conditions.push(Prisma.sql`${DISTANCE_KM} <= ${filter.maxDistanceKm}`);
    }
    if (filter.dispatchedOnly) {
      conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM request_dispatches rd
        WHERE rd.service_request_id = sr.id AND rd.provider_id = pr.id)`);
    }
    const cursor = decodeCursor(filter.cursor);
    let order: Prisma.Sql;
    let keyExpr: Prisma.Sql;
    if (sort === 'NEAREST') {
      keyExpr = NEAREST_KEY;
      order = Prisma.sql`${NEAREST_KEY} ASC, sr.id ASC`;
      if (cursor) conditions.push(Prisma.sql`(${NEAREST_KEY}, sr.id) > (${cursor.k}::float8, ${cursor.id}::uuid)`);
    } else if (sort === 'BUDGET') {
      keyExpr = BUDGET_KEY;
      order = Prisma.sql`${BUDGET_KEY} DESC, sr.id DESC`;
      if (cursor) conditions.push(Prisma.sql`(${BUDGET_KEY}, sr.id) < (${cursor.k}::float8, ${cursor.id}::uuid)`);
    } else {
      keyExpr = Prisma.sql`0::float8`;
      order = Prisma.sql`sr.id DESC`;
      if (cursor) conditions.push(Prisma.sql`sr.id < ${cursor.id}::uuid`);
    }
    const rows = await this.prisma.$queryRaw<{ id: string; distanceKm: number | null; k: number }[]>`
      SELECT sr.id, (${DISTANCE_KM})::float8 AS "distanceKm", (${keyExpr})::float8 AS k
      FROM service_requests sr
      ${JOINS}
      JOIN provider_profiles pr ON pr.id = ${providerId}::uuid
      ${PROVIDER_JOIN}
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY ${order}
      LIMIT ${filter.limit + 1}`;
    const page = rows.slice(0, filter.limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => ({ id: r.id, distanceKm: r.distanceKm })),
      nextCursor:
        rows.length > filter.limit && last
          ? sort === 'NEW'
            ? last.id
            : encodeCursor({ k: last.k, id: last.id })
          : null,
    };
  }

  /** Faz 2 signature kept for callers that only need ids. */
  async opportunityIds(providerId: string, filter: OpportunityFilter): Promise<string[]> {
    return (await this.opportunities(providerId, filter)).items.map((i) => i.id);
  }

  /** Re-checks one pair; used before showing a detail page or taking a quote. */
  async isEligible(db: Db, providerId: string, requestId: string): Promise<boolean> {
    const rows = await db.$queryRaw<{ ok: number }[]>`
      SELECT 1 AS ok FROM service_requests sr
      ${JOINS}
      JOIN provider_profiles pr ON pr.id = ${providerId}::uuid
      ${PROVIDER_JOIN}
      WHERE sr.id = ${requestId}::uuid AND ${this.eligible}`;
    return rows.length > 0;
  }

  /** Approximate distance from the provider's service centre to a request (km), if known. */
  async distanceKm(db: Db, providerId: string, requestId: string): Promise<number | null> {
    const rows = await db.$queryRaw<{ km: number | null }[]>`
      SELECT (${DISTANCE_KM})::float8 AS km FROM service_requests sr
      JOIN districts d ON d.id = sr.district_id
      JOIN provider_profiles pr ON pr.id = ${providerId}::uuid
      ${PROVIDER_JOIN}
      WHERE sr.id = ${requestId}::uuid`;
    return rows[0]?.km ?? null;
  }

  /**
   * Every provider eligible for a request right now, with the signals
   * MATCH_V1 scores (matching/domain/match-score.ts). Bounded by `limit`
   * as a safety net; ordering here is only a pre-sort, the score decides.
   */
  async candidates(
    db: Db,
    requestId: string,
    opts: { limit: number; excludeDispatched?: boolean } = { limit: 2000 },
  ): Promise<CandidateRow[]> {
    const extra = opts.excludeDispatched
      ? Prisma.sql`AND NOT EXISTS (SELECT 1 FROM request_dispatches rd
          WHERE rd.service_request_id = sr.id AND rd.provider_id = pr.id)
        AND NOT EXISTS (SELECT 1 FROM quotes q
          WHERE q.service_request_id = sr.id AND q.provider_id = pr.id)`
      : Prisma.empty;
    return db.$queryRaw<CandidateRow[]>`
      SELECT pr.id, pr.user_id AS "userId",
        CASE WHEN EXISTS (SELECT 1 FROM provider_service_areas pa
                          WHERE pa.provider_id = pr.id AND pa.district_id = sr.district_id)
             THEN 'DISTRICT' ELSE 'REGION' END AS "areaFit",
        (${DISTANCE_KM})::float8 AS "distanceKm",
        pr.accepting_new_jobs AS "acceptingNewJobs",
        pr.unavailable_until AS "unavailableUntil",
        ps.score::float8 AS score,
        ps.is_new_provider AS "isNewProvider",
        (SELECT count(*) FROM jobs j WHERE j.provider_id = pr.id AND j.status = 'COMPLETED')::int
          AS "completedJobs",
        (SELECT count(*) FROM jobs j WHERE j.provider_id = pr.id
           AND j.cancellation_actor = 'PROVIDER' AND j.created_at > now() - interval '90 days')::int
          AS "providerCancelledJobs",
        (SELECT count(*) FROM jobs j WHERE j.provider_id = pr.id
           AND j.created_at > now() - interval '90 days'
           AND (j.cancellation_actor IS NULL OR j.cancellation_actor = 'PROVIDER'))::int
          AS "attributableJobs",
        pr.last_active_at AS "lastActiveAt",
        pr.approved_at AS "approvedAt",
        EXISTS (SELECT 1 FROM provider_verification_cases vc
                WHERE vc.provider_id = pr.id AND vc.status = 'VERIFIED') AS verified,
        (pr.account_status = 'LIMITED') AS "accountLimited",
        EXISTS (SELECT 1 FROM disciplinary_actions da
                WHERE da.subject_id = pr.user_id AND da.subject_role = 'PROVIDER'
                  AND da.type = 'VISIBILITY_REDUCTION' AND da.status IN ('ACTIVE', 'UNDER_APPEAL')
                  AND da.starts_at <= now() AND (da.ends_at IS NULL OR da.ends_at > now()))
          AS "visibilityReduced",
        (SELECT count(*) FROM disciplinary_actions da
         WHERE da.subject_id = pr.user_id AND da.subject_role = 'PROVIDER'
           AND da.type = 'WARNING' AND da.status IN ('ACTIVE', 'UNDER_APPEAL')
           AND da.starts_at <= now() AND (da.ends_at IS NULL OR da.ends_at > now()))::int
          AS "activeWarnings"
      FROM service_requests sr
      ${JOINS}
      CROSS JOIN provider_profiles pr
      ${PROVIDER_JOIN}
      LEFT JOIN provider_scores ps ON ps.provider_id = pr.id
      WHERE sr.id = ${requestId}::uuid AND ${this.eligible} ${extra}
      ORDER BY ps.score DESC NULLS LAST, pr.id
      LIMIT ${opts.limit}`;
  }

  /**
   * Faz 2/3 helper kept for NOW compatibility: eligible providers ordered
   * by UstaScore ranking. Dispatch now goes through ProviderMatchingService.
   */
  async eligibleProviders(
    db: Db,
    requestId: string,
    limit: number,
  ): Promise<{ id: string; userId: string }[]> {
    const rows = await this.candidates(db, requestId, { limit });
    return rows.map((r) => ({ id: r.id, userId: r.userId }));
  }
}
