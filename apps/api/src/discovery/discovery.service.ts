import { Inject, Injectable } from '@nestjs/common';
import type { ApiEnv } from '@ustago/config';
import type {
  CategoryRef,
  CustomerHome,
  FavoriteProvider,
  Paginated,
  ProviderCard,
  RehireDraft,
  SearchResult,
} from '@ustago/types';
import {
  type DiscoverProvidersQuery,
  normalizeSearchText,
  sanitizeQueryForAnalytics,
  type SearchClick,
  type SearchQuery,
} from '@ustago/validation';

import { MarketplaceEventsService } from '../analytics/marketplace-events.service.js';
import { AvailabilityEvaluator } from '../availability/availability-evaluator.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { notFound, unprocessable } from '../common/http/errors.js';
import { toMoney } from '../common/money.js';
import { API_ENV } from '../config/env.js';
import { GeoService } from '../geo/geo.service.js';
import { launchStatusOf } from '../locations/locations.service.js';
import { scoreProvider } from '../matching/domain/match-score.js';
import { DISTANCE_HORIZON_KM, toSignals } from '../matching/provider-matching.service.js';
import { ResponseStatsService } from '../matching/response-stats.service.js';
import { metrics } from '../observability/metrics.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { DiscoveryRepository } from './discovery.repository.js';
import { searchCategories, type SearchableCategory } from './domain/category-search.js';
import {
  decodeOffset,
  encodeOffset,
  filterProviders,
  type SortableProvider,
  sortProviders,
} from './domain/provider-sort.js';
import { ProviderCardsBuilder } from './provider-cards.builder.js';

const CATALOG_CACHE_MS = 60_000;
const DISCOVERY_CANDIDATE_LIMIT = 1000;
const HOME_SECTION = 6;
const FAVORITES_PER_HOUR = 120;
const ACTIVE_JOB_STATUSES = [
  'CREATED',
  'CONFIRMED',
  'PROVIDER_PREPARING',
  'PROVIDER_EN_ROUTE',
  'PROVIDER_ARRIVED',
  'IN_PROGRESS',
  'AWAITING_COMPLETION_CONFIRMATION',
  'DISPUTED',
] as const;
const OPEN_REQUEST = ['PUBLISHED', 'MATCHING', 'QUOTED'] as const;

interface CatalogEntry extends SearchableCategory {
  ref: CategoryRef;
}

/**
 * Customer discovery (docs/adr/0028): search, provider lists, favorites,
 * home and rehire. Everything shown is a real count or a real record;
 * sections without data stay empty.
 */
@Injectable()
export class DiscoveryService {
  private catalog: { at: number; entries: CatalogEntry[] } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: DiscoveryRepository,
    private readonly cards: ProviderCardsBuilder,
    private readonly responses: ResponseStatsService,
    private readonly availability: AvailabilityEvaluator,
    private readonly geo: GeoService,
    private readonly events: MarketplaceEventsService,
    private readonly rateLimit: RateLimitService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  /** Active categories (and parents) with their aliases, cached briefly. */
  private async searchable(): Promise<CatalogEntry[]> {
    if (this.catalog && Date.now() - this.catalog.at < CATALOG_CACHE_MS)
      return this.catalog.entries;
    const rows = await this.prisma.serviceCategory.findMany({
      where: { isActive: true, OR: [{ parentId: null }, { parent: { isActive: true } }] },
      select: {
        id: true,
        slug: true,
        name: true,
        icon: true,
        sortOrder: true,
        aliases: { select: { alias: true } },
      },
    });
    const entries = rows.map((c) => ({
      id: c.id,
      name: c.name,
      sortOrder: c.sortOrder,
      aliases: c.aliases.map((a) => a.alias),
      ref: { id: c.id, slug: c.slug, name: c.name, icon: c.icon },
    }));
    this.catalog = { at: Date.now(), entries };
    return entries;
  }

  /** Drops the search cache (after an admin edits categories or aliases). */
  invalidateCatalog(): void {
    this.catalog = null;
  }

  async search(subject: string, query: SearchQuery): Promise<SearchResult> {
    await this.rateLimit.enforce({
      bucket: 'search',
      subject,
      limit: this.env.SEARCH_RATE_LIMIT_PER_MINUTE,
      windowSeconds: 60,
    });
    const catalog = await this.searchable();
    const hits = searchCategories(query.q, catalog, query.limit);
    const byId = new Map(catalog.map((c) => [c.id, c]));
    const categories = hits.flatMap((h) => {
      const c = byId.get(h.categoryId);
      return c ? [{ category: c.ref, matchKind: h.matchKind, matchedText: h.matchedText }] : [];
    });
    const noResult = categories.length === 0;
    const suggestions = noResult ? await this.suggestions(catalog) : [];
    const sanitized = sanitizeQueryForAnalytics(query.q);
    metrics.searchRequests.inc({
      outcome: noResult ? 'no_result' : categories[0]?.matchKind === 'FUZZY' ? 'fuzzy' : 'hit',
    });
    await this.events.record({
      type: noResult ? 'search_no_result' : 'search_performed',
      value: categories.length,
      categoryId: categories[0]?.category.id ?? null,
      ...(sanitized ? { metadata: { q: sanitized } } : {}),
    });
    return { query: query.q, categories, suggestions, noResult };
  }

  /** No match: real popular categories if there are any, else the catalogue order. */
  private async suggestions(catalog: CatalogEntry[]): Promise<CategoryRef[]> {
    const popular = await this.popularCategories(undefined);
    if (popular.length > 0) return popular.slice(0, 5);
    return [...catalog]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .slice(0, 5)
      .map((c) => c.ref);
  }

  async searchClick(input: SearchClick): Promise<void> {
    const sanitized = input.query ? sanitizeQueryForAnalytics(input.query) : null;
    await this.events.record({
      type: 'search_category_clicked',
      categoryId: input.categoryId,
      ...(sanitized ? { metadata: { q: sanitized } } : {}),
    });
  }

  /**
   * Categories by real request counts in the last 30 days, only above
   * POPULAR_CATEGORY_MIN_REQUESTS. Empty is a valid answer.
   */
  async popularCategories(provinceId: number | undefined): Promise<CategoryRef[]> {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const rows = await this.prisma.serviceRequest.groupBy({
      by: ['categoryId'],
      where: {
        createdAt: { gte: since },
        status: { not: 'DRAFT' },
        ...(provinceId ? { provinceId } : {}),
      },
      _count: { _all: true },
      orderBy: { _count: { categoryId: 'desc' } },
      take: 20,
    });
    const qualified = rows.filter((r) => r._count._all >= this.env.POPULAR_CATEGORY_MIN_REQUESTS);
    if (qualified.length === 0) return [];
    const catalog = new Map((await this.searchable()).map((c) => [c.id, c.ref]));
    return qualified
      .flatMap((r) => {
        const ref = catalog.get(r.categoryId);
        return ref ? [ref] : [];
      })
      .slice(0, 8);
  }

  // -------------------------------------------------------------------------
  // Provider discovery
  // -------------------------------------------------------------------------

  async listProviders(
    user: AuthUser | undefined,
    query: DiscoverProvidersQuery,
  ): Promise<Paginated<ProviderCard>> {
    const started = process.hrtime.bigint();
    const customerId = user ? await this.customerId(user.id) : null;
    const now = new Date();
    const rows = await this.repo.candidates({
      limit: DISCOVERY_CANDIDATE_LIMIT,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.districtId ? { districtId: query.districtId } : {}),
      ...(query.provinceId ? { provinceId: query.provinceId } : {}),
    });
    const ids = rows.map((r) => r.id);
    const [raw, avail, from] = await Promise.all([
      this.responses.rawFor(ids),
      this.availability.evaluate(rows, now),
      this.geo.districtCentre(query.districtId),
    ]);
    const publicStats = new Map(ids.map((id) => [id, this.responses.toPublic(raw.get(id))]));
    const cards = await this.cards.build(
      ids,
      { from, customerId, now },
      { responseStats: publicStats },
    );
    const cfg = {
      now,
      coldStartDays: this.env.MATCH_COLD_START_DAYS,
      responseMinSample: this.env.RESPONSE_STATS_MIN_SAMPLE,
      distanceHorizonKm: DISTANCE_HORIZON_KM,
    };
    const items: SortableProvider[] = rows.flatMap((r) => {
      const card = cards.get(r.id);
      if (!card) return [];
      const signals = toSignals(r, raw.get(r.id) ?? null, avail.get(r.id)?.workingNow ?? false);
      return [{ card, matchScore: scoreProvider(signals, cfg).score }];
    });
    const filtered = filterProviders(items, {
      minRating: query.minRating,
      verifiedOnly: query.verifiedOnly,
      availableToday: query.availableToday,
      maxDistanceKm: query.maxDistanceKm,
    });
    const sorted = sortProviders(filtered, query.sort);
    const offset = decodeOffset(query.cursor);
    const page = sorted.slice(offset, offset + query.limit);
    metrics.matchingDuration.observe(Number(process.hrtime.bigint() - started) / 1e9, {
      operation: 'discover',
    });
    return {
      items: page.map((p) => p.card),
      nextCursor: offset + query.limit < sorted.length ? encodeOffset(offset + query.limit) : null,
    };
  }

  // -------------------------------------------------------------------------
  // Favorites (the provider never sees who favorited them)
  // -------------------------------------------------------------------------

  async listFavorites(
    user: AuthUser,
    query: { cursor?: string | undefined; limit: number },
  ): Promise<Paginated<FavoriteProvider>> {
    const customerId = await this.requireCustomer(user.id);
    const offset = decodeOffset(query.cursor);
    const rows = await this.prisma.favoriteProvider.findMany({
      where: { customerId },
      orderBy: [{ createdAt: 'desc' }, { providerId: 'asc' }],
      skip: offset,
      take: query.limit + 1,
      select: {
        providerId: true,
        createdAt: true,
        provider: {
          select: {
            status: true,
            accountStatus: true,
            deletedAt: true,
            user: { select: { status: true, deletedAt: true } },
          },
        },
      },
    });
    const page = rows.slice(0, query.limit);
    const from = await this.customerPoint(customerId);
    const cards = await this.cards.build(
      page.map((r) => r.providerId),
      { from, customerId },
    );
    return {
      items: page.flatMap((r) => {
        const card = cards.get(r.providerId);
        if (!card) return [];
        const p = r.provider;
        const suspended = p.accountStatus === 'SUSPENDED' || p.accountStatus === 'BANNED';
        const listed =
          p.status === 'ACTIVE' && !p.deletedAt && p.user.status === 'ACTIVE' && !p.user.deletedAt;
        return [
          {
            provider: card,
            available: !suspended && listed,
            unavailableReason: suspended
              ? ('SUSPENDED' as const)
              : listed
                ? null
                : ('NOT_LISTED' as const),
            createdAt: r.createdAt.toISOString(),
          },
        ];
      }),
      nextCursor: rows.length > query.limit ? encodeOffset(offset + query.limit) : null,
    };
  }

  async addFavorite(user: AuthUser, providerId: string): Promise<void> {
    const customerId = await this.requireCustomer(user.id);
    // Favorites feed the provider's analytics: cap toggling spam.
    await this.rateLimit.enforce({
      bucket: 'favorite',
      subject: user.id,
      limit: FAVORITES_PER_HOUR,
      windowSeconds: 3600,
    });
    const provider = await this.prisma.providerProfile.findFirst({
      where: {
        id: providerId,
        status: 'ACTIVE',
        accountStatus: { in: ['ACTIVE', 'LIMITED'] },
        deletedAt: null,
        userId: { not: user.id },
      },
      select: { id: true },
    });
    if (!provider) throw notFound('PROVIDER_NOT_FOUND', 'Usta bulunamadı.');
    const created = await this.prisma.favoriteProvider.createMany({
      data: [{ customerId, providerId }],
      skipDuplicates: true,
    });
    if (created.count > 0) {
      await this.events.record({ type: 'provider_favorited', providerId });
    }
  }

  async removeFavorite(user: AuthUser, providerId: string): Promise<void> {
    const customerId = await this.requireCustomer(user.id);
    await this.prisma.favoriteProvider.deleteMany({ where: { customerId, providerId } });
  }

  // -------------------------------------------------------------------------
  // Home and rehire
  // -------------------------------------------------------------------------

  async home(user: AuthUser): Promise<CustomerHome> {
    const customerId = await this.requireCustomer(user.id);
    const address =
      (await this.prisma.address.findFirst({
        where: { userId: user.id, deletedAt: null, isDefault: true },
        select: addressAreaSelect,
      })) ??
      (await this.prisma.address.findFirst({
        where: { userId: user.id, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: addressAreaSelect,
      }));
    const [jobs, requests, favorites, completed, recent] = await Promise.all([
      this.prisma.job.findMany({
        where: { customerId, status: { in: [...ACTIVE_JOB_STATUSES] } },
        orderBy: { updatedAt: 'desc' },
        take: HOME_SECTION,
        select: {
          id: true,
          status: true,
          currentTotalMinor: true,
          currency: true,
          updatedAt: true,
          provider: { select: { displayName: true } },
          serviceRequest: { select: { category: { select: categoryRefSelect } } },
        },
      }),
      this.prisma.serviceRequest.findMany({
        where: {
          customerId,
          status: { in: [...OPEN_REQUEST] },
          quotes: { some: { status: { in: ['PENDING_CUSTOMER', 'PENDING_PROVIDER'] } } },
        },
        orderBy: { updatedAt: 'desc' },
        take: HOME_SECTION,
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          category: { select: categoryRefSelect },
          quotes: {
            where: { status: { in: ['PENDING_CUSTOMER', 'PENDING_PROVIDER'] } },
            select: { id: true },
          },
        },
      }),
      this.prisma.favoriteProvider.findMany({
        where: {
          customerId,
          provider: {
            status: 'ACTIVE',
            accountStatus: { in: ['ACTIVE', 'LIMITED'] },
            deletedAt: null,
          },
        },
        orderBy: { createdAt: 'desc' },
        take: HOME_SECTION,
        select: { providerId: true },
      }),
      this.prisma.job.findMany({
        where: {
          customerId,
          status: 'COMPLETED',
          completedAt: { gte: new Date(Date.now() - 365 * 86_400_000) },
          provider: {
            status: 'ACTIVE',
            accountStatus: { in: ['ACTIVE', 'LIMITED'] },
            deletedAt: null,
          },
        },
        orderBy: { completedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          providerId: true,
          completedAt: true,
          serviceRequest: { select: { category: { select: categoryRefSelect } } },
        },
      }),
      this.prisma.serviceRequest.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { category: { select: categoryRefSelect } },
      }),
    ]);
    const rehireJobs: typeof completed = [];
    const seen = new Set<string>();
    for (const j of completed) {
      if (seen.has(j.providerId) || rehireJobs.length >= HOME_SECTION) continue;
      seen.add(j.providerId);
      rehireJobs.push(j);
    }
    const from = address ? await this.geo.districtCentre(address.districtId) : null;
    const nearby = address
      ? await this.listProviders(user, {
          districtId: address.districtId,
          sort: 'RECOMMENDED',
          limit: HOME_SECTION,
        } as DiscoverProvidersQuery)
      : { items: [], nextCursor: null };
    const cards = await this.cards.build(
      [...favorites.map((f) => f.providerId), ...rehireJobs.map((j) => j.providerId)],
      { from, customerId },
    );
    const recentCategories: CategoryRef[] = [];
    for (const r of recent) {
      if (recentCategories.some((c) => c.id === r.category.id)) continue;
      recentCategories.push(r.category);
      if (recentCategories.length >= 5) break;
    }
    return {
      area: address
        ? {
            province: { id: address.province.id, name: address.province.name },
            district: { id: address.district.id, name: address.district.name },
          }
        : null,
      launchStatus: address ? launchStatusOf(address.province) : null,
      activeJobs: jobs.map((j) => ({
        jobId: j.id,
        status: j.status,
        category: j.serviceRequest.category,
        providerName: j.provider.displayName,
        total: toMoney(j.currentTotalMinor, j.currency),
        updatedAt: j.updatedAt.toISOString(),
      })),
      requestsWithQuotes: requests.map((r) => ({
        requestId: r.id,
        title: r.title,
        category: r.category,
        status: r.status,
        openQuoteCount: r.quotes.length,
        createdAt: r.createdAt.toISOString(),
      })),
      favorites: favorites.flatMap((f) => cards.get(f.providerId) ?? []),
      rehire: rehireJobs.flatMap((j) => {
        const card = cards.get(j.providerId);
        return card && j.completedAt
          ? [
              {
                jobId: j.id,
                provider: card,
                category: j.serviceRequest.category,
                completedAt: j.completedAt.toISOString(),
              },
            ]
          : [];
      }),
      recentCategories,
      popularCategories: await this.popularCategories(address?.province.id),
      nearbyProviders: nearby.items,
    };
  }

  async rehireDraft(user: AuthUser, jobId: string): Promise<RehireDraft> {
    const customerId = await this.requireCustomer(user.id);
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, customerId },
      select: {
        id: true,
        status: true,
        provider: {
          select: {
            id: true,
            displayName: true,
            status: true,
            accountStatus: true,
            deletedAt: true,
          },
        },
        serviceRequest: {
          select: {
            category: { select: { ...categoryRefSelect, isActive: true } },
            address: { select: { id: true, deletedAt: true } },
          },
        },
      },
    });
    if (!job) throw notFound('JOB_NOT_FOUND', 'İş bulunamadı.');
    if (job.status !== 'COMPLETED') {
      throw unprocessable(
        'REHIRE_JOB_NOT_COMPLETED',
        'Yalnızca tamamlanmış bir iş için usta tekrar çağrılabilir.',
      );
    }
    const p = job.provider;
    const { isActive: _active, ...category } = job.serviceRequest.category;
    const address = job.serviceRequest.address;
    return {
      jobId: job.id,
      category,
      provider: {
        id: p.id,
        displayName: p.displayName,
        available:
          p.status === 'ACTIVE' &&
          !p.deletedAt &&
          (p.accountStatus === 'ACTIVE' || p.accountStatus === 'LIMITED'),
      },
      addressId: address.deletedAt ? null : address.id,
      title: `${category.name} işi (tekrar)`,
    };
  }

  // -------------------------------------------------------------------------

  private async customerId(userId: string): Promise<string | null> {
    const c = await this.prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    return c?.id ?? null;
  }

  private async requireCustomer(userId: string): Promise<string> {
    const id = await this.customerId(userId);
    if (!id) throw unprocessable('CUSTOMER_PROFILE_MISSING', 'Müşteri profili bulunamadı.');
    return id;
  }

  private async customerPoint(customerId: string) {
    const c = await this.prisma.customerProfile.findUnique({
      where: { id: customerId },
      select: { userId: true },
    });
    if (!c) return null;
    const a = await this.prisma.address.findFirst({
      where: { userId: c.userId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      select: { districtId: true },
    });
    return this.geo.districtCentre(a?.districtId ?? null);
  }
}

const categoryRefSelect = { id: true, slug: true, name: true, icon: true } as const;
const addressAreaSelect = {
  districtId: true,
  province: { select: { id: true, name: true, isActive: true, waitlistOpen: true } },
  district: { select: { id: true, name: true } },
} as const;

export const normalizeForSearch = normalizeSearchText;
