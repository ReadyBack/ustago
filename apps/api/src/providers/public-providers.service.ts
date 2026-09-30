import { Inject, Injectable } from '@nestjs/common';
import type { CategoryRef, PublicProviderProfileV2 } from '@ustago/types';

import type { AuthUser } from '../common/auth/auth-user.js';
import { notFound } from '../common/http/errors.js';
import { API_ENV, type ApiEnv } from '../config/env.js';
import type { Prisma } from '../generated/prisma/client.js';
import { approxDistance } from '../geo/distance.js';
import { GeoService } from '../geo/geo.service.js';
import { ResponseStatsService } from '../matching/response-stats.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PortfolioService } from '../provider-media/portfolio.service.js';
import { ProviderMediaService } from '../provider-media/provider-media.service.js';
import { publicUstaScore } from '../quality/domain/usta-score.js';
import { toProviderRating } from '../reviews/domain/review-policy.js';
import {
  publicReviewInclude,
  publishedReviewsWhere,
  reviewDistributionOf,
  toPublicReview,
} from '../reviews/public-reviews.js';
import { computeAvailability } from './domain/availability.js';
import { providerPolicy } from './domain/provider-policy.js';
import { serviceAreaLabels } from './domain/service-area-labels.js';
import { isCategoryLive } from './provider.mappers.js';
import { publiclyListedProviderWhere } from './public-visibility.js';

const RECENT_REVIEWS = 5;

/**
 * Allow-list of columns for the public profile. No phone, e-mail, national
 * id, documents, IBAN, address, coordinates or admin notes are ever read.
 */
const profileSelect = {
  id: true,
  userId: true,
  status: true,
  accountStatus: true,
  displayName: true,
  bio: true,
  yearsOfExperience: true,
  photoStorageKey: true,
  acceptingNewJobs: true,
  unavailableUntil: true,
  serviceCenterDistrictId: true,
  approvedAt: true,
  createdAt: true,
  services: {
    select: {
      category: {
        select: {
          id: true,
          slug: true,
          name: true,
          icon: true,
          isActive: true,
          sortOrder: true,
          parent: { select: { isActive: true } },
        },
      },
    },
  },
  serviceAreas: {
    orderBy: [{ createdAt: 'asc' }, { districtId: 'asc' }],
    select: {
      districtId: true,
      district: {
        select: { name: true, isActive: true, province: { select: { id: true, name: true } } },
      },
    },
  },
  serviceRegions: {
    where: { active: true },
    select: {
      kind: true,
      provinceId: true,
      radiusKm: true,
      province: { select: { name: true } },
      centerDistrict: { select: { name: true } },
    },
  },
  weeklyHours: { select: { weekday: true, startMinute: true, endMinute: true } },
  timeOff: {
    where: { cancelledAt: null },
    select: { startsAt: true, endsAt: true, cancelledAt: true },
  },
  score: { select: { score: true, isNewProvider: true, algorithmVersion: true } },
  verificationCase: { select: { status: true } },
} satisfies Prisma.ProviderProfileSelect;

/**
 * Customer-facing provider profile V2 (Faz 7, docs/adr/0028/0029). Only
 * publicly listed providers (approved, account open) are visible; others
 * are a 404. Every number is a real aggregate: published reviews,
 * completed jobs, real response data (null below the minimum sample).
 * The distance is approximate (straight line between district centres).
 * "Doğrulanmış" is an identity/account badge, never a quality claim.
 */
@Injectable()
export class PublicProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geo: GeoService,
    private readonly responseStats: ResponseStatsService,
    private readonly media: ProviderMediaService,
    private readonly portfolio: PortfolioService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async get(
    id: string,
    query: { districtId?: string | undefined },
    viewer?: AuthUser,
  ): Promise<PublicProviderProfileV2> {
    const now = new Date();
    const p = await this.prisma.providerProfile.findFirst({
      where: { id, ...publiclyListedProviderWhere },
      select: {
        ...profileSelect,
        timeOff: { ...profileSelect.timeOff, where: { cancelledAt: null, endsAt: { gt: now } } },
      },
    });
    if (!p) throw notFound('PROVIDER_NOT_FOUND', 'Usta bulunamadı.');

    const centreDistrictId = p.serviceCenterDistrictId ?? p.serviceAreas[0]?.districtId ?? null;
    const [
      ratingAgg,
      distribution,
      completedJobCount,
      recent,
      stats,
      portfolio,
      photoUrl,
      isFavorite,
      km,
    ] = await Promise.all([
      this.prisma.review.aggregate({
        where: publishedReviewsWhere(p.userId),
        _avg: { rating: true },
        _count: { _all: true },
      }),
      reviewDistributionOf(this.prisma, p.userId),
      this.prisma.job.count({ where: { providerId: p.id, status: 'COMPLETED' } }),
      this.prisma.review.findMany({
        where: publishedReviewsWhere(p.userId),
        include: publicReviewInclude,
        orderBy: { id: 'desc' },
        take: RECENT_REVIEWS,
      }),
      this.responseStats.forProviders([p.id]),
      this.portfolio.publicPortfolio(p.id),
      this.media.photoUrl(p.photoStorageKey),
      this.isFavorite(viewer, p.id),
      query.districtId
        ? this.geo.districtDistanceKm(query.districtId, centreDistrictId)
        : Promise.resolve(null),
    ]);

    const availability = computeAvailability({
      acceptingNewJobs: p.acceptingNewJobs,
      unavailableUntil: p.unavailableUntil,
      weeklyHours: p.weeklyHours,
      timeOff: p.timeOff,
      now,
      timeZone: this.env.MARKETPLACE_TIME_ZONE,
    });

    const categories: CategoryRef[] = p.services
      .filter((s) => isCategoryLive(s.category))
      .sort(
        (a, b) =>
          a.category.sortOrder - b.category.sortOrder ||
          a.category.name.localeCompare(b.category.name, 'tr'),
      )
      .map(({ category: c }) => ({ id: c.id, slug: c.slug, name: c.name, icon: c.icon }));

    return {
      id: p.id,
      displayName: p.displayName,
      photoUrl,
      bio: p.bio,
      yearsOfExperience: p.yearsOfExperience,
      isVerified: providerPolicy({
        applicationStatus: p.status,
        verificationStatus: p.verificationCase?.status ?? 'NOT_STARTED',
        accountStatus: p.accountStatus,
      }).showVerifiedBadge,
      ustaScore: publicUstaScore(
        p.score
          ? {
              score: Number(p.score.score),
              isNewProvider: p.score.isNewProvider,
              algorithmVersion: p.score.algorithmVersion,
            }
          : null,
      ),
      isNewProvider: p.score?.isNewProvider ?? true,
      rating: toProviderRating(ratingAgg._count._all, ratingAgg._avg.rating),
      reviewDistribution: distribution,
      completedJobCount,
      categories,
      serviceAreaLabels: serviceAreaLabels(
        p.serviceAreas.map((a) => ({
          provinceId: a.district.province.id,
          provinceName: a.district.province.name,
          districtName: a.district.name,
          isActive: a.district.isActive,
        })),
        p.serviceRegions.map((r) => ({
          kind: r.kind,
          provinceId: r.provinceId,
          provinceName: r.province.name,
          centerDistrictName: r.centerDistrict?.name ?? null,
          radiusKm: r.radiusKm,
        })),
      ),
      distance: approxDistance(km),
      availability: {
        availableToday: availability.availableToday,
        onTimeOff: availability.onTimeOff,
        acceptingNewJobs: p.acceptingNewJobs,
      },
      responseStats: stats.get(p.id) ?? null,
      portfolio,
      recentReviews: recent.map(toPublicReview),
      isFavorite,
      memberSince: (p.approvedAt ?? p.createdAt).toISOString(),
    };
  }

  /** Only a signed-in customer's own saved list counts; anyone else sees false. */
  private async isFavorite(viewer: AuthUser | undefined, providerId: string): Promise<boolean> {
    if (!viewer) return false;
    const favorite = await this.prisma.favoriteProvider.findFirst({
      where: { providerId, customer: { userId: viewer.id } },
      select: { providerId: true },
    });
    return favorite !== null;
  }
}
