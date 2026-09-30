import { Injectable } from '@nestjs/common';
import type { PublicProviderProfile } from '@ustago/types';

import { notFound } from '../common/http/errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toProviderRating } from '../reviews/domain/review-policy.js';
import { publicProviderInclude, toPublicProvider } from './provider.mappers.js';

/**
 * Customer-facing provider data. Only ACTIVE providers are visible. The
 * rating and job count are real aggregates (published reviews, completed
 * jobs); the UstaScore comes from the quality snapshot and is hidden while
 * the provider is new.
 */
@Injectable()
export class PublicProvidersService {
  constructor(private readonly prisma: PrismaService) {}

  async get(id: string): Promise<PublicProviderProfile> {
    const provider = await this.prisma.providerProfile.findFirst({
      // Faz 6: suspended or banned accounts are not shown to customers.
      where: {
        id,
        status: 'ACTIVE',
        accountStatus: { in: ['ACTIVE', 'LIMITED'] },
        deletedAt: null,
        user: { status: 'ACTIVE', deletedAt: null },
      },
      include: publicProviderInclude,
    });
    if (!provider) throw notFound('PROVIDER_NOT_FOUND', 'Usta bulunamadı.');
    const [reviews, completedJobCount] = await Promise.all([
      this.prisma.review.aggregate({
        where: {
          targetId: provider.userId,
          direction: 'CUSTOMER_TO_PROVIDER',
          status: 'PUBLISHED',
        },
        _avg: { rating: true },
        _count: { _all: true },
      }),
      this.prisma.job.count({ where: { providerId: id, status: 'COMPLETED' } }),
    ]);
    return toPublicProvider(provider, {
      rating: toProviderRating(reviews._count._all, reviews._avg.rating),
      completedJobCount,
    });
  }
}
