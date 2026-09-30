import type { PublicReview, ReviewDistribution } from '@ustago/types';
import { maskPersonName } from '@ustago/validation';

import type { Prisma } from '../generated/prisma/client.js';

/**
 * Customer-facing reviews (shared by the review list and the public profile
 * V2). Built from an allow-list: masked author name, category name, the
 * ratings, the comment and the provider's one public reply. Never a job
 * id, address or contact detail.
 */
export const publicReviewInclude = {
  author: { select: { firstName: true, lastName: true } },
  job: { select: { category: { select: { name: true } } } },
  reply: { select: { body: true, createdAt: true } },
} satisfies Prisma.ReviewInclude;

type PublicReviewRow = Prisma.ReviewGetPayload<{ include: typeof publicReviewInclude }>;

/** Published customer reviews about a provider's user. */
export function publishedReviewsWhere(targetUserId: string) {
  return {
    targetId: targetUserId,
    direction: 'CUSTOMER_TO_PROVIDER',
    status: 'PUBLISHED',
  } satisfies Prisma.ReviewWhereInput;
}

export function toPublicReview(r: PublicReviewRow): PublicReview {
  return {
    id: r.id,
    rating: r.rating,
    qualityRating: r.qualityRating,
    communicationRating: r.communicationRating,
    punctualityRating: r.punctualityRating,
    valueRating: r.priceRating,
    comment: r.comment,
    authorName: maskPersonName(r.author.firstName, r.author.lastName),
    categoryName: r.job.category.name,
    createdAt: r.createdAt.toISOString(),
    reply: r.reply ? { body: r.reply.body, createdAt: r.reply.createdAt.toISOString() } : null,
  };
}

/** Star counts from `groupBy(rating)` rows; missing stars are 0. */
export function toReviewDistribution(
  rows: readonly { rating: number; count: number }[],
): ReviewDistribution {
  const at = (star: number) => rows.find((r) => r.rating === star)?.count ?? 0;
  return { five: at(5), four: at(4), three: at(3), two: at(2), one: at(1) };
}

/** Distribution of a provider's published reviews (hidden/moderated never count). */
export async function reviewDistributionOf(
  prisma: Pick<Prisma.TransactionClient, 'review'>,
  targetUserId: string,
): Promise<ReviewDistribution> {
  const rows = await prisma.review.groupBy({
    by: ['rating'],
    where: publishedReviewsWhere(targetUserId),
    _count: { _all: true },
  });
  return toReviewDistribution(rows.map((r) => ({ rating: r.rating, count: r._count._all })));
}
