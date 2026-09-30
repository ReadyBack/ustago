import { Inject, Injectable } from '@nestjs/common';
import type { ProviderCard, ResponseStats } from '@ustago/types';

import { AvailabilityEvaluator } from '../availability/availability-evaluator.js';
import { approxDistance, coarsen, type GeoPoint } from '../geo/distance.js';
import { GeoService } from '../geo/geo.service.js';
import { ResponseStatsService } from '../matching/response-stats.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { publicUstaScore } from '../quality/domain/usta-score.js';
import { toProviderRating } from '../reviews/domain/review-policy.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/object-storage.js';

const PHOTO_URL_SECONDS = 600;
const AREA_NAMES_SHOWN = 3;

export interface CardContext {
  /** The customer's approximate point (a district centre), for "Yaklaşık X km". */
  from?: GeoPoint | null;
  /** Customer profile id, for `isFavorite`. */
  customerId?: string | null;
  now?: Date;
}

/**
 * Provider cards for search results, favorites and home sections
 * (docs/adr/0028). Real aggregates only; photo through a short-lived signed
 * URL; map position is the service-centre district centre, never a home.
 */
@Injectable()
export class ProviderCardsBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geo: GeoService,
    private readonly availability: AvailabilityEvaluator,
    private readonly responses: ResponseStatsService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async build(
    providerIds: readonly string[],
    ctx: CardContext = {},
    known?: { responseStats?: Map<string, ResponseStats | null> },
  ): Promise<Map<string, ProviderCard>> {
    const out = new Map<string, ProviderCard>();
    const ids = [...new Set(providerIds)];
    if (ids.length === 0) return out;
    const now = ctx.now ?? new Date();
    const [providers, ratings, completed, favorites, at] = await Promise.all([
      this.prisma.providerProfile.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          userId: true,
          displayName: true,
          photoStorageKey: true,
          acceptingNewJobs: true,
          unavailableUntil: true,
          serviceCenterDistrictId: true,
          score: { select: { score: true, isNewProvider: true, algorithmVersion: true } },
          verificationCase: { select: { status: true } },
          services: {
            where: { category: { isActive: true } },
            select: {
              category: {
                select: { id: true, slug: true, name: true, icon: true, sortOrder: true },
              },
            },
          },
          serviceAreas: {
            select: {
              district: { select: { name: true, province: { select: { id: true, name: true } } } },
            },
          },
          serviceRegions: {
            where: { active: true },
            select: {
              kind: true,
              radiusKm: true,
              province: { select: { name: true } },
              centerDistrict: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.review.groupBy({
        by: ['targetId'],
        where: {
          direction: 'CUSTOMER_TO_PROVIDER',
          status: 'PUBLISHED',
          target: { providerProfile: { id: { in: ids } } },
        },
        _avg: { rating: true },
        _count: { _all: true },
      }),
      this.prisma.job.groupBy({
        by: ['providerId'],
        where: { providerId: { in: ids }, status: 'COMPLETED' },
        _count: { _all: true },
      }),
      ctx.customerId
        ? this.prisma.favoriteProvider.findMany({
            where: { customerId: ctx.customerId, providerId: { in: ids } },
            select: { providerId: true },
          })
        : Promise.resolve([]),
      this.geo.ready(),
    ]);
    const [avail, stats] = await Promise.all([
      this.availability.evaluate(providers, now),
      known?.responseStats ?? this.responses.forProviders(ids),
    ]);
    const ratingBy = new Map(ratings.map((r) => [r.targetId, r]));
    const completedBy = new Map(completed.map((c) => [c.providerId, c._count._all]));
    const favSet = new Set(favorites.map((f) => f.providerId));
    const photos = await Promise.all(
      providers.map(async (p) =>
        p.photoStorageKey
          ? [p.id, (await this.storage.createDownloadUrl(p.photoStorageKey, PHOTO_URL_SECONDS)).url]
          : [p.id, null],
      ),
    );
    const photoBy = new Map(photos as [string, string | null][]);

    for (const p of providers) {
      const r = ratingBy.get(p.userId);
      const center = at(p.serviceCenterDistrictId);
      const snapshot = p.score
        ? {
            score: Number(p.score.score),
            isNewProvider: p.score.isNewProvider,
            algorithmVersion: p.score.algorithmVersion,
          }
        : null;
      out.set(p.id, {
        id: p.id,
        displayName: p.displayName,
        photoUrl: photoBy.get(p.id) ?? null,
        isVerified: p.verificationCase?.status === 'VERIFIED',
        rating: toProviderRating(r?._count._all ?? 0, r?._avg.rating ?? null),
        completedJobCount: completedBy.get(p.id) ?? 0,
        ustaScore: publicUstaScore(snapshot),
        isNewProvider: !snapshot || snapshot.isNewProvider,
        categories: p.services
          .map((s) => s.category)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(({ id, slug, name, icon }) => ({ id, slug, name, icon })),
        areaLabel: areaLabel(p.serviceAreas, p.serviceRegions),
        distance: approxDistance(this.geo.distanceKm(center, ctx.from ?? null)),
        availableToday: avail.get(p.id)?.availableToday ?? false,
        responseStats: stats.get(p.id) ?? null,
        isFavorite: favSet.has(p.id),
        approxPoint: center ? { lat: coarsen(center.lat), lng: coarsen(center.lng) } : null,
      });
    }
    return out;
  }
}

export function areaLabel(
  areas: readonly { district: { name: string; province: { id: number; name: string } } }[],
  regions: readonly {
    kind: 'PROVINCE' | 'RADIUS';
    radiusKm: number | null;
    province: { name: string };
    centerDistrict: { name: string } | null;
  }[],
): string {
  const parts: string[] = [];
  for (const r of regions) {
    if (r.kind === 'PROVINCE') parts.push(`${r.province.name} (tüm il)`);
    else if (r.centerDistrict)
      parts.push(`${r.centerDistrict.name} merkezli ${r.radiusKm ?? 0} km`);
  }
  const byProvince = new Map<string, string[]>();
  for (const a of areas) {
    const list = byProvince.get(a.district.province.name) ?? [];
    list.push(a.district.name);
    byProvince.set(a.district.province.name, list);
  }
  for (const [province, names] of byProvince) {
    const sorted = [...names].sort((x, y) => x.localeCompare(y, 'tr'));
    const shown = sorted.slice(0, AREA_NAMES_SHOWN).join(', ');
    const more = sorted.length > AREA_NAMES_SHOWN ? ` +${sorted.length - AREA_NAMES_SHOWN}` : '';
    parts.push(`${shown}${more} / ${province}`);
  }
  return parts.join(' · ');
}
