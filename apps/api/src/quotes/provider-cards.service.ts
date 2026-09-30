import { Injectable } from '@nestjs/common';
import type { QuoteProviderCard } from '@ustago/types';

import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Provider summary for quote cards, from real data only: the rating is the
 * average of published customer reviews (null → "Yeni Usta"), never the
 * seeded UstaScore placeholder; "verified" means an admin approved the
 * identity document. No phone or e-mail before agreement.
 */
@Injectable()
export class ProviderCardsService {
  constructor(private readonly prisma: PrismaService) {}

  async cards(providerIds: string[]): Promise<Map<string, QuoteProviderCard>> {
    const ids = [...new Set(providerIds)];
    if (ids.length === 0) return new Map();
    const providers = await this.prisma.providerProfile.findMany({
      where: { id: { in: ids } },
      select: { id: true, userId: true, displayName: true, yearsOfExperience: true },
    });
    const userIds = providers.map((p) => p.userId);
    const [identity, completed, ratings] = await Promise.all([
      this.prisma.providerVerification.findMany({
        where: { providerId: { in: ids }, type: 'IDENTITY', status: 'APPROVED' },
        select: { providerId: true },
      }),
      this.prisma.job.groupBy({
        by: ['providerId'],
        where: { providerId: { in: ids }, status: 'COMPLETED' },
        _count: { _all: true },
      }),
      this.prisma.review.groupBy({
        by: ['targetId'],
        where: {
          targetId: { in: userIds },
          direction: 'CUSTOMER_TO_PROVIDER',
          status: 'PUBLISHED',
        },
        _avg: { rating: true },
        _count: { _all: true },
      }),
    ]);
    const verified = new Set(identity.map((v) => v.providerId));
    const completedBy = new Map(completed.map((c) => [c.providerId, c._count._all]));
    const ratingBy = new Map(ratings.map((r) => [r.targetId, r]));

    return new Map(
      providers.map((p) => {
        const rating = ratingBy.get(p.userId);
        return [
          p.id,
          {
            id: p.id,
            displayName: p.displayName,
            yearsOfExperience: p.yearsOfExperience,
            identityVerified: verified.has(p.id),
            rating:
              rating && rating._count._all > 0 && rating._avg.rating !== null
                ? {
                    average: Math.round(rating._avg.rating * 10) / 10,
                    count: rating._count._all,
                  }
                : null,
            completedJobCount: completedBy.get(p.id) ?? 0,
          },
        ];
      }),
    );
  }

  async card(providerId: string): Promise<QuoteProviderCard> {
    const card = (await this.cards([providerId])).get(providerId);
    if (!card) throw new Error(`Provider ${providerId} not found`);
    return card;
  }
}
