import { Inject, Injectable } from '@nestjs/common';
import type {
  AdminDispatchTimeline,
  AdminMatchPreview,
  CategoryStats,
  MarketplaceEventName,
  MarketplaceOverview,
  NoOfferRequestRow,
  Paginated,
  RegionStats,
} from '@ustago/types';
import {
  type CategoryStatsQuery,
  type MarketplaceOverviewQuery,
  type NoOfferQuery,
  noOfferQuerySchema,
  type RegionStatsQuery,
} from '@ustago/validation';

import { notFound } from '../common/http/errors.js';
import { API_ENV, type ApiEnv } from '../config/env.js';
import { launchStatusOf } from '../locations/locations.service.js';
import { ProviderMatchingService } from '../matching/provider-matching.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  compareRegions,
  funnelSteps,
  medianPriceOrNull,
  parseBreakdown,
  percent,
  roundMedian,
  toRegionStats,
} from './domain/analytics-math.js';
import { MarketplaceAnalyticsRepository } from './marketplace-analytics.repository.js';

/** The overview KPI uses the no-offer list's default age, so the linked page shows the same set. */
export const NO_OFFER_DEFAULT_MINUTES = noOfferQuerySchema.parse({}).olderThanMinutes;
const TOP_NO_RESULT_QUERIES = 10;
/** Upper bound on timeline events returned for one request. */
const MAX_TIMELINE_EVENTS = 500;

const NOT_FOUND = () => notFound('SERVICE_REQUEST_NOT_FOUND', 'Talep bulunamadı.');

/**
 * Admin marketplace analytics (docs/faz7/API-CONTRACT.md, docs/adr/0028):
 * funnel, regional supply and demand, category health, requests waiting
 * without an offer, and the dispatch/ranking internals of one request.
 * Everything comes from real rows; nothing here writes.
 */
@Injectable()
export class MarketplaceAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: MarketplaceAnalyticsRepository,
    private readonly matching: ProviderMatchingService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async overview(query: MarketplaceOverviewQuery): Promise<MarketplaceOverview> {
    const timeZone = this.env.MARKETPLACE_TIME_ZONE;
    const [funnel, today, noOffer, providers, search] = await Promise.all([
      this.repo.funnel(query.days),
      this.repo.today(timeZone),
      this.repo.noOfferCount(NO_OFFER_DEFAULT_MINUTES),
      this.repo.providerCounts(),
      this.repo.search(query.days, TOP_NO_RESULT_QUERIES),
    ]);
    return {
      periodDays: query.days,
      timeZone,
      today,
      quoteRatePercent: percent(funnel.quoted, funnel.created),
      acceptanceRatePercent: percent(funnel.accepted, funnel.quoted),
      completionRatePercent: percent(funnel.completed, funnel.accepted),
      medianFirstQuoteMinutes: roundMedian(funnel.medianFirstQuoteMinutes),
      noOfferOpenRequests: noOffer,
      activeProviders: providers.active,
      availableProviders: providers.available,
      funnel: funnelSteps(funnel),
      search,
    };
  }

  async regions(query: RegionStatsQuery): Promise<RegionStats[]> {
    if (query.provinceId !== undefined) {
      const exists = await this.prisma.province.findUnique({
        where: { id: query.provinceId },
        select: { id: true },
      });
      if (!exists) throw notFound('PROVINCE_NOT_FOUND', 'İl bulunamadı.');
    }
    const rows = await this.repo.regions(query.days, query.provinceId);
    return rows
      .map((r) =>
        toRegionStats({
          province: { id: r.provinceId, name: r.provinceName },
          district:
            r.districtId && r.districtName ? { id: r.districtId, name: r.districtName } : null,
          requests: r.requests,
          quotes: r.quotes,
          completedJobs: r.completedJobs,
          unservedRequests: r.unservedRequests,
          activeProviders: r.activeProviders,
          availableProviders: r.availableProviders,
          launchStatus: launchStatusOf(r),
        }),
      )
      .sort(compareRegions);
  }

  async categories(query: CategoryStatsQuery): Promise<CategoryStats[]> {
    const rows = await this.repo.categories(query.days);
    return rows.map((r) => ({
      category: { id: r.id, slug: r.slug, name: r.name, icon: r.icon },
      requests: r.requests,
      quotes: r.quotes,
      acceptanceRatePercent: percent(r.jobs, r.quotedRequests),
      completionRatePercent: percent(r.completedJobs, r.jobs),
      medianPriceMinor: medianPriceOrNull(
        r.medianPrice,
        r.priceSample,
        r.priceProviders,
        this.env.PRICE_GUIDE_MIN_SAMPLE,
        this.env.PRICE_GUIDE_MIN_PROVIDERS,
      ),
      activeProviders: r.activeProviders,
    }));
  }

  async noOffer(query: NoOfferQuery): Promise<Paginated<NoOfferRequestRow>> {
    const rows = await this.repo.noOffer(query.olderThanMinutes, query.limit, query.cursor);
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((r) => ({
        id: r.id,
        title: r.title,
        category: {
          id: r.categoryId,
          slug: r.categorySlug,
          name: r.categoryName,
          icon: r.categoryIcon,
        },
        province: { id: r.provinceId, name: r.provinceName },
        district: { id: r.districtId, name: r.districtName },
        wave: r.wave,
        dispatchedCount: r.dispatchedCount,
        publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
        ageMinutes: r.ageMinutes,
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /** Request → dispatch waves → views and quotes, with the stored MATCH_V1 breakdowns. */
  async dispatchTimeline(requestId: string): Promise<AdminDispatchTimeline> {
    const request = await this.prisma.serviceRequest.findUnique({
      where: { id: requestId },
      select: { id: true, dispatchWave: true, nextDispatchAt: true },
    });
    if (!request) throw NOT_FOUND();
    const [dispatches, events] = await Promise.all([
      this.prisma.requestDispatch.findMany({
        where: { serviceRequestId: requestId },
        orderBy: [{ wave: 'asc' }, { matchScore: 'desc' }, { providerId: 'asc' }],
        include: { provider: { select: { displayName: true } } },
      }),
      this.prisma.marketplaceEvent.findMany({
        where: { serviceRequestId: requestId },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        take: MAX_TIMELINE_EVENTS,
        select: { type: true, occurredAt: true, providerId: true, value: true },
      }),
    ]);
    return {
      requestId: request.id,
      wave: request.dispatchWave,
      nextDispatchAt: request.nextDispatchAt?.toISOString() ?? null,
      rows: dispatches.map((d) => ({
        providerId: d.providerId,
        providerName: d.provider.displayName,
        wave: d.wave,
        algorithmVersion: d.algorithmVersion,
        matchScore: Number(d.matchScore),
        breakdown: parseBreakdown(d.scoreBreakdown),
        distanceKm: d.distanceKm === null ? null : Number(d.distanceKm),
        isPreferred: d.isPreferred,
        notifyMode: d.notifyMode,
        dispatchedAt: d.dispatchedAt.toISOString(),
        viewedAt: d.viewedAt?.toISOString() ?? null,
        respondedAt: d.respondedAt?.toISOString() ?? null,
        result: d.result,
      })),
      events: events.map((e) => ({
        type: e.type as MarketplaceEventName,
        occurredAt: e.occurredAt.toISOString(),
        providerId: e.providerId,
        value: e.value,
      })),
    };
  }

  /**
   * The live MATCH_V1 ranking for a request, without dispatching: runs in
   * a READ ONLY transaction, so no dispatch row, notification or event can
   * be written even by mistake. Includes providers already dispatched.
   */
  async matchPreview(requestId: string): Promise<AdminMatchPreview> {
    const request = await this.prisma.serviceRequest.findUnique({
      where: { id: requestId },
      select: { id: true },
    });
    if (!request) throw NOT_FOUND();
    const started = process.hrtime.bigint();
    const { ranked, dispatched, names } = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const ranked = await this.matching.rank(requestId, { excludeDispatched: false, db: tx });
      const ids = ranked.map((c) => c.providerId);
      // Sequential: one connection serves the whole transaction.
      const dispatched = await tx.requestDispatch.findMany({
        where: { serviceRequestId: requestId },
        select: { providerId: true },
      });
      const names =
        ids.length === 0
          ? []
          : await tx.providerProfile.findMany({
              where: { id: { in: ids } },
              select: { id: true, displayName: true },
            });
      return { ranked, dispatched, names };
    });
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    const sent = new Set(dispatched.map((d) => d.providerId));
    const nameOf = new Map(names.map((n) => [n.id, n.displayName]));
    return {
      requestId,
      algorithmVersion: this.matching.algorithmVersion,
      candidates: ranked.map((c) => ({
        providerId: c.providerId,
        providerName: nameOf.get(c.providerId) ?? '',
        score: c.score,
        breakdown: c.breakdown,
        distanceKm: c.distanceKm,
        alreadyDispatched: sent.has(c.providerId),
      })),
      durationMs: Math.round(durationMs * 100) / 100,
    };
  }
}
