import { Injectable } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client.js';
import { haversineSql } from '../matching/matching.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { FunnelCounts } from './domain/analytics-math.js';

/**
 * Read-only SQL for the admin marketplace analytics (docs/adr/0028). Every
 * value is a bound parameter (Prisma.sql); nothing is concatenated.
 *
 * Cohort: requests created in the period (drafts excluded). Every funnel,
 * region and category number is about that cohort, so the steps of one
 * report always describe the same requests.
 */

/** Listed = could be matched at all (approved, not deleted, account usable). */
const LISTED = Prisma.sql`pr.status = 'ACTIVE' AND pr.deleted_at IS NULL
  AND pr.account_status IN ('ACTIVE', 'LIMITED')`;

/**
 * Available = listed and taking new work right now (docs/adr/0031): "Yeni
 * iş alma" on, not "bugün müsait değilim", no time off in progress, no
 * job restriction in force.
 */
const AVAILABLE = Prisma.sql`${LISTED}
  AND pr.accepting_new_jobs
  AND (pr.unavailable_until IS NULL OR pr.unavailable_until <= now())
  AND NOT EXISTS (SELECT 1 FROM provider_time_off t
                  WHERE t.provider_id = pr.id AND t.cancelled_at IS NULL
                    AND t.starts_at <= now() AND t.ends_at > now())
  AND NOT EXISTS (SELECT 1 FROM disciplinary_actions da
                  WHERE da.subject_id = pr.user_id AND da.subject_role = 'PROVIDER'
                    AND da.type = 'JOB_RESTRICTION' AND da.status IN ('ACTIVE', 'UNDER_APPEAL')
                    AND da.starts_at <= now() AND (da.ends_at IS NULL OR da.ends_at > now()))`;

const since = (days: number) => Prisma.sql`now() - make_interval(days => ${days}::int)`;

/** The request `c` was sent to at least one provider (wave dispatch or a NOW offer). */
const DISPATCHED = Prisma.sql`(EXISTS (SELECT 1 FROM request_dispatches rd WHERE rd.service_request_id = c.id)
  OR EXISTS (SELECT 1 FROM emergency_dispatch_offers eo WHERE eo.service_request_id = c.id))`;

/**
 * Open request without any offer for at least `olderThanMinutes` since
 * publication (`sr`). Shared by the overview KPI and the no-offer list.
 */
export function noOfferWhere(olderThanMinutes: number): Prisma.Sql {
  return Prisma.sql`sr.status IN ('PUBLISHED', 'MATCHING')
    AND (sr.expires_at IS NULL OR sr.expires_at > now())
    AND NOT EXISTS (SELECT 1 FROM quotes q WHERE q.service_request_id = sr.id)
    AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.service_request_id = sr.id)
    AND COALESCE(sr.published_at, sr.created_at)
        <= now() - make_interval(mins => ${olderThanMinutes}::int)`;
}

export interface OverviewRow extends FunnelCounts {
  medianFirstQuoteMinutes: number | null;
}

export interface RawRegionSql {
  provinceId: number;
  provinceName: string;
  isActive: boolean;
  waitlistOpen: boolean;
  districtId: string | null;
  districtName: string | null;
  requests: number;
  quotes: number;
  completedJobs: number;
  unservedRequests: number;
  activeProviders: number;
  availableProviders: number;
}

export interface RawCategorySql {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  requests: number;
  quotes: number;
  quotedRequests: number;
  jobs: number;
  completedJobs: number;
  activeProviders: number;
  medianPrice: number | null;
  priceSample: number;
  priceProviders: number;
}

export interface NoOfferSqlRow {
  id: string;
  title: string;
  wave: number;
  publishedAt: Date | null;
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  categoryIcon: string | null;
  provinceId: number;
  provinceName: string;
  districtId: string;
  districtName: string;
  dispatchedCount: number;
  ageMinutes: number;
}

@Injectable()
export class MarketplaceAnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cohort funnel. Steps are cumulative ("reached at least this step"): a
   * request that got a quote was necessarily seen by that provider even if
   * the view was not recorded, and a NOW acceptance is the provider's offer.
   */
  async funnel(days: number): Promise<OverviewRow> {
    const [row] = await this.prisma.$queryRaw<
      {
        created: number;
        dispatched: number;
        viewed: number;
        quoted: number;
        accepted: number;
        started: number;
        completed: number;
        median: number | null;
      }[]
    >`
      WITH cohort AS (
        SELECT sr.id, sr.published_at, sr.created_at
        FROM service_requests sr
        WHERE sr.created_at >= ${since(days)} AND sr.status <> 'DRAFT'
      ), flags AS (
        SELECT c.id,
               (j.id IS NOT NULL AND j.status = 'COMPLETED') AS completed,
               (j.id IS NOT NULL AND (j.started_at IS NOT NULL OR j.status = 'COMPLETED')) AS started,
               (j.id IS NOT NULL) AS accepted,
               EXISTS (SELECT 1 FROM quotes q WHERE q.service_request_id = c.id) AS quoted,
               (EXISTS (SELECT 1 FROM request_dispatches rd
                        WHERE rd.service_request_id = c.id AND rd.viewed_at IS NOT NULL)
                OR EXISTS (SELECT 1 FROM marketplace_events e
                           WHERE e.service_request_id = c.id AND e.type = 'provider_viewed_request'))
                 AS viewed,
               ${DISPATCHED} AS dispatched,
               (SELECT extract(epoch FROM min(q.created_at) - COALESCE(c.published_at, c.created_at)) / 60.0
                FROM quotes q WHERE q.service_request_id = c.id) AS first_quote_minutes
        FROM cohort c
        LEFT JOIN jobs j ON j.service_request_id = c.id
      )
      SELECT count(*)::int AS created,
             count(*) FILTER (WHERE dispatched OR viewed OR quoted OR accepted)::int AS dispatched,
             count(*) FILTER (WHERE viewed OR quoted OR accepted)::int AS viewed,
             count(*) FILTER (WHERE quoted OR accepted)::int AS quoted,
             count(*) FILTER (WHERE accepted)::int AS accepted,
             count(*) FILTER (WHERE started)::int AS started,
             count(*) FILTER (WHERE completed)::int AS completed,
             (percentile_cont(0.5) WITHIN GROUP (ORDER BY greatest(first_quote_minutes, 0))
               FILTER (WHERE first_quote_minutes IS NOT NULL))::float8 AS median
      FROM flags`;
    return {
      created: row?.created ?? 0,
      dispatched: row?.dispatched ?? 0,
      viewed: row?.viewed ?? 0,
      quoted: row?.quoted ?? 0,
      accepted: row?.accepted ?? 0,
      started: row?.started ?? 0,
      completed: row?.completed ?? 0,
      medianFirstQuoteMinutes: row?.median ?? null,
    };
  }

  /** Counts since local midnight in `timeZone` (PostgreSQL does the zone arithmetic). */
  async today(
    timeZone: string,
  ): Promise<{ requestsCreated: number; quotes: number; jobsCompleted: number }> {
    const [row] = await this.prisma.$queryRaw<
      { requests: number; quotes: number; completed: number }[]
    >`
      WITH day AS (
        SELECT (date_trunc('day', now() AT TIME ZONE ${timeZone}) AT TIME ZONE ${timeZone}) AS start
      )
      SELECT
        (SELECT count(*) FROM service_requests sr, day
         WHERE sr.created_at >= day.start AND sr.status <> 'DRAFT')::int AS requests,
        (SELECT count(*) FROM quotes q, day WHERE q.created_at >= day.start)::int AS quotes,
        (SELECT count(*) FROM jobs j, day
         WHERE j.status = 'COMPLETED' AND j.completed_at >= day.start)::int AS completed`;
    return {
      requestsCreated: row?.requests ?? 0,
      quotes: row?.quotes ?? 0,
      jobsCompleted: row?.completed ?? 0,
    };
  }

  async noOfferCount(olderThanMinutes: number): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM service_requests sr WHERE ${noOfferWhere(olderThanMinutes)}`;
    return row?.n ?? 0;
  }

  async providerCounts(): Promise<{ active: number; available: number }> {
    const [row] = await this.prisma.$queryRaw<{ active: number; available: number }[]>`
      SELECT count(*) FILTER (WHERE ${LISTED})::int AS active,
             count(*) FILTER (WHERE ${AVAILABLE})::int AS available
      FROM provider_profiles pr
      WHERE pr.status = 'ACTIVE' AND pr.deleted_at IS NULL`;
    return { active: row?.active ?? 0, available: row?.available ?? 0 };
  }

  async search(
    days: number,
    top: number,
  ): Promise<{
    searches: number;
    noResult: number;
    topNoResultQueries: { query: string; count: number }[];
  }> {
    const [counts, topRows] = await Promise.all([
      this.prisma.$queryRaw<{ searches: number; noResult: number }[]>`
        SELECT count(*)::int AS searches,
               count(*) FILTER (WHERE e.type = 'search_no_result')::int AS "noResult"
        FROM marketplace_events e
        WHERE e.type IN ('search_performed', 'search_no_result')
          AND e.occurred_at >= ${since(days)}`,
      // Queries were sanitised before they were stored (discovery.service).
      this.prisma.$queryRaw<{ query: string; count: number }[]>`
        SELECT e.metadata->>'q' AS query, count(*)::int AS count
        FROM marketplace_events e
        WHERE e.type = 'search_no_result' AND e.occurred_at >= ${since(days)}
          AND e.metadata->>'q' IS NOT NULL AND length(e.metadata->>'q') > 0
        GROUP BY 1
        ORDER BY 2 DESC, 1 ASC
        LIMIT ${top}`,
    ]);
    return {
      searches: counts[0]?.searches ?? 0,
      noResult: counts[0]?.noResult ?? 0,
      topNoResultQueries: topRows,
    };
  }

  /**
   * One row per province (no `provinceId`) or per district of a province.
   * Supply = listed providers whose service areas cover the region: an
   * explicit district, a whole-province region, or (district view) a
   * radius region whose circle reaches the district's centre.
   */
  async regions(days: number, provinceId?: number): Promise<RawRegionSql[]> {
    if (provinceId === undefined) {
      return this.prisma.$queryRaw<RawRegionSql[]>`
        WITH req AS (
          SELECT c.province_id AS pid,
                 count(*)::int AS requests,
                 coalesce(sum((SELECT count(*) FROM quotes q WHERE q.service_request_id = c.id)), 0)::int
                   AS quotes,
                 count(*) FILTER (WHERE j.status = 'COMPLETED')::int AS completed,
                 count(*) FILTER (WHERE NOT ${DISPATCHED})::int AS unserved
          FROM service_requests c
          LEFT JOIN jobs j ON j.service_request_id = c.id
          WHERE c.created_at >= ${since(days)} AND c.status <> 'DRAFT'
          GROUP BY c.province_id
        ), cov AS (
          SELECT d.province_id AS pid, pa.provider_id
          FROM provider_service_areas pa JOIN districts d ON d.id = pa.district_id
          UNION
          SELECT rg.province_id, rg.provider_id FROM provider_service_regions rg WHERE rg.active
        ), sup AS (
          SELECT cov.pid,
                 count(*) FILTER (WHERE ${LISTED})::int AS active,
                 count(*) FILTER (WHERE ${AVAILABLE})::int AS available
          FROM cov JOIN provider_profiles pr ON pr.id = cov.provider_id
          GROUP BY cov.pid
        )
        SELECT p.id AS "provinceId", p.name AS "provinceName",
               p.is_active AS "isActive", p.waitlist_open AS "waitlistOpen",
               NULL::uuid AS "districtId", NULL::text AS "districtName",
               coalesce(req.requests, 0) AS requests, coalesce(req.quotes, 0) AS quotes,
               coalesce(req.completed, 0) AS "completedJobs",
               coalesce(req.unserved, 0) AS "unservedRequests",
               coalesce(sup.active, 0) AS "activeProviders",
               coalesce(sup.available, 0) AS "availableProviders"
        FROM provinces p
        LEFT JOIN req ON req.pid = p.id
        LEFT JOIN sup ON sup.pid = p.id
        WHERE p.is_active OR coalesce(req.requests, 0) > 0 OR coalesce(sup.active, 0) > 0
        ORDER BY p.id`;
    }
    return this.prisma.$queryRaw<RawRegionSql[]>`
      WITH req AS (
        SELECT c.district_id AS did,
               count(*)::int AS requests,
               coalesce(sum((SELECT count(*) FROM quotes q WHERE q.service_request_id = c.id)), 0)::int
                 AS quotes,
               count(*) FILTER (WHERE j.status = 'COMPLETED')::int AS completed,
               count(*) FILTER (WHERE NOT ${DISPATCHED})::int AS unserved
        FROM service_requests c
        LEFT JOIN jobs j ON j.service_request_id = c.id
        WHERE c.province_id = ${provinceId}::smallint
          AND c.created_at >= ${since(days)} AND c.status <> 'DRAFT'
        GROUP BY c.district_id
      ), cov AS (
        SELECT pa.district_id AS did, pa.provider_id
        FROM provider_service_areas pa JOIN districts d ON d.id = pa.district_id
        WHERE d.province_id = ${provinceId}::smallint
        UNION
        SELECT d.id, rg.provider_id
        FROM provider_service_regions rg JOIN districts d ON d.province_id = rg.province_id
        WHERE rg.active AND rg.kind = 'PROVINCE' AND rg.province_id = ${provinceId}::smallint
        UNION
        SELECT d.id, rg.provider_id
        FROM provider_service_regions rg
        JOIN districts d ON d.province_id = ${provinceId}::smallint AND d.latitude IS NOT NULL
        WHERE rg.active AND rg.kind = 'RADIUS'
          AND ${haversineSql(Prisma.sql`rg.center_lat`, Prisma.sql`rg.center_lng`, Prisma.sql`d.latitude`, Prisma.sql`d.longitude`)}
              <= rg.radius_km
      ), sup AS (
        SELECT cov.did,
               count(*) FILTER (WHERE ${LISTED})::int AS active,
               count(*) FILTER (WHERE ${AVAILABLE})::int AS available
        FROM cov JOIN provider_profiles pr ON pr.id = cov.provider_id
        GROUP BY cov.did
      )
      SELECT p.id AS "provinceId", p.name AS "provinceName",
             p.is_active AS "isActive", p.waitlist_open AS "waitlistOpen",
             d.id AS "districtId", d.name AS "districtName",
             coalesce(req.requests, 0) AS requests, coalesce(req.quotes, 0) AS quotes,
             coalesce(req.completed, 0) AS "completedJobs",
             coalesce(req.unserved, 0) AS "unservedRequests",
             coalesce(sup.active, 0) AS "activeProviders",
             coalesce(sup.available, 0) AS "availableProviders"
      FROM districts d
      JOIN provinces p ON p.id = d.province_id
      LEFT JOIN req ON req.did = d.id
      LEFT JOIN sup ON sup.did = d.id
      WHERE d.province_id = ${provinceId}::smallint
        AND (d.is_active OR coalesce(req.requests, 0) > 0)
      ORDER BY d.name`;
  }

  /** Per category: cohort demand and outcomes, listed supply, completed-job median price. */
  async categories(days: number): Promise<RawCategorySql[]> {
    return this.prisma.$queryRaw<RawCategorySql[]>`
      WITH req AS (
        SELECT c.category_id AS cid,
               count(*)::int AS requests,
               coalesce(sum((SELECT count(*) FROM quotes q WHERE q.service_request_id = c.id)), 0)::int
                 AS quotes,
               count(*) FILTER (WHERE j.id IS NOT NULL
                 OR EXISTS (SELECT 1 FROM quotes q WHERE q.service_request_id = c.id))::int
                 AS quoted_requests,
               count(j.id)::int AS jobs,
               count(*) FILTER (WHERE j.status = 'COMPLETED')::int AS completed
        FROM service_requests c
        LEFT JOIN jobs j ON j.service_request_id = c.id
        WHERE c.created_at >= ${since(days)} AND c.status <> 'DRAFT'
        GROUP BY c.category_id
      ), sup AS (
        SELECT ps.category_id AS cid, count(*)::int AS active
        FROM provider_services ps JOIN provider_profiles pr ON pr.id = ps.provider_id
        WHERE ${LISTED}
        GROUP BY ps.category_id
      ), price AS (
        SELECT j.category_id AS cid,
               (percentile_cont(0.5) WITHIN GROUP (ORDER BY j.agreed_price_minor))::float8 AS median,
               count(*)::int AS sample,
               count(DISTINCT j.provider_id)::int AS providers
        FROM jobs j
        WHERE j.status = 'COMPLETED' AND j.completed_at >= ${since(days)}
        GROUP BY j.category_id
      )
      SELECT sc.id, sc.slug, sc.name, sc.icon,
             coalesce(req.requests, 0) AS requests, coalesce(req.quotes, 0) AS quotes,
             coalesce(req.quoted_requests, 0) AS "quotedRequests",
             coalesce(req.jobs, 0) AS jobs, coalesce(req.completed, 0) AS "completedJobs",
             coalesce(sup.active, 0) AS "activeProviders",
             price.median AS "medianPrice",
             coalesce(price.sample, 0) AS "priceSample",
             coalesce(price.providers, 0) AS "priceProviders"
      FROM service_categories sc
      LEFT JOIN req ON req.cid = sc.id
      LEFT JOIN sup ON sup.cid = sc.id
      LEFT JOIN price ON price.cid = sc.id
      WHERE coalesce(req.requests, 0) > 0 OR coalesce(sup.active, 0) > 0
        OR coalesce(price.sample, 0) > 0
      ORDER BY coalesce(req.requests, 0) DESC, sc.name ASC`;
  }

  /** Oldest first (UUIDv7 ids are time ordered); keyset on id. */
  async noOffer(
    olderThanMinutes: number,
    limit: number,
    cursor: string | undefined,
  ): Promise<NoOfferSqlRow[]> {
    const after = cursor ? Prisma.sql`AND sr.id > ${cursor}::uuid` : Prisma.empty;
    return this.prisma.$queryRaw<NoOfferSqlRow[]>`
      SELECT sr.id, sr.title, sr.dispatch_wave::int AS wave, sr.published_at AS "publishedAt",
             c.id AS "categoryId", c.slug AS "categorySlug", c.name AS "categoryName",
             c.icon AS "categoryIcon",
             p.id AS "provinceId", p.name AS "provinceName",
             d.id AS "districtId", d.name AS "districtName",
             (SELECT count(*) FROM request_dispatches rd WHERE rd.service_request_id = sr.id)::int
               AS "dispatchedCount",
             greatest(0, floor(extract(epoch FROM now() - COALESCE(sr.published_at, sr.created_at)) / 60))::int
               AS "ageMinutes"
      FROM service_requests sr
      JOIN service_categories c ON c.id = sr.category_id
      JOIN provinces p ON p.id = sr.province_id
      JOIN districts d ON d.id = sr.district_id
      WHERE ${noOfferWhere(olderThanMinutes)} ${after}
      ORDER BY sr.id ASC
      LIMIT ${limit + 1}`;
  }
}
