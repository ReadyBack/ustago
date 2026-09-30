import { Injectable } from '@nestjs/common';
import type {
  Paginated,
  ProviderReviewReply,
  PublicReview,
  Review,
  ReviewDistribution,
} from '@ustago/types';
import {
  type CreateReview,
  type ListProviderReviewsQuery,
  type ReplyToReview,
  type UpdateReview,
} from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { badRequest, conflict, forbidden, notFound } from '../common/http/errors.js';
import { Prisma } from '../generated/prisma/client.js';
import { toReview } from '../jobs/job.mappers.js';
import { JobStore } from '../jobs/job.store.js';
import { NotificationEvent } from '../notifications/notification-events.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { publiclyListedProviderWhere } from '../providers/public-visibility.js';
import { QualityService } from '../quality/quality.service.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { isEditable, reviewEligibility } from './domain/review-policy.js';
import {
  publicReviewInclude,
  publishedReviewsWhere,
  reviewDistributionOf,
  toPublicReview,
} from './public-reviews.js';

/** Review writes per user per hour: generous for real use, a wall for scripts. */
const REVIEW_WRITE_LIMIT = 20;
const REVIEW_WRITE_WINDOW_SECONDS = 3600;

const reviewNotFound = () => notFound('REVIEW_NOT_FOUND', 'Değerlendirme bulunamadı.');
const replyExists = () =>
  conflict('REVIEW_REPLY_EXISTS', 'Bu değerlendirmeye zaten cevap verdiniz.');
const alreadyReviewed = () =>
  conflict('REVIEW_ALREADY_EXISTS', 'Bu iş için zaten değerlendirme yaptınız.');

/**
 * Customer reviews (docs/adr/0016). Only the customer of a COMPLETED job
 * writes one, once (unique [job, direction]); edits are allowed for 30
 * days and every write is audited with the previous values. Hidden
 * reviews stay in the database but never count or show.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: JobStore,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly quality: QualityService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async create(
    user: AuthUser,
    jobId: string,
    input: CreateReview,
    ipAddress: string | null,
  ): Promise<Review> {
    await this.limit(user.id);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const locked = await this.store.lockForParty(tx, jobId, user.id);
        const eligibility = reviewEligibility(
          { status: locked.job.status, customerUserId: locked.customerUserId },
          user.id,
        );
        if (!eligibility.ok) {
          if (eligibility.reason === 'NOT_CUSTOMER') {
            throw forbidden(
              'REVIEW_NOT_ALLOWED',
              'Yalnızca işin müşterisi değerlendirme yapabilir.',
            );
          }
          throw conflict(
            'REVIEW_NOT_ALLOWED',
            'Değerlendirme yalnızca tamamlanan işler için yapılabilir.',
            { status: locked.job.status },
          );
        }
        const existing = await tx.review.count({
          where: { jobId, direction: 'CUSTOMER_TO_PROVIDER' },
        });
        if (existing > 0) throw alreadyReviewed();
        const review = await tx.review.create({
          data: {
            jobId,
            direction: 'CUSTOMER_TO_PROVIDER',
            authorId: user.id,
            targetId: locked.providerUserId,
            rating: input.rating,
            qualityRating: input.qualityRating ?? null,
            communicationRating: input.communicationRating ?? null,
            punctualityRating: input.punctualityRating ?? null,
            priceRating: input.valueRating ?? null,
            comment: input.comment ?? null,
          },
        });
        await this.audit.recordIn(tx, {
          action: 'review.created',
          actorId: user.id,
          entityType: 'review',
          entityId: review.id,
          ipAddress,
          metadata: { jobId, providerId: locked.job.providerId, rating: review.rating },
        });
        await this.notifications.enqueueIn(tx, [
          {
            userId: locked.providerUserId,
            type: NotificationEvent.REVIEW_RECEIVED,
            title: `Yeni değerlendirme: 5 üzerinden ${review.rating} yıldız`,
            body: locked.title,
            data: { jobId, reviewId: review.id },
          },
        ]);
        await this.quality.recalculateIn(tx, [locked.job.providerId]);
        return review;
      });
      return toReview(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw alreadyReviewed();
      }
      throw error;
    }
  }

  async update(
    user: AuthUser,
    id: string,
    input: UpdateReview,
    ipAddress: string | null,
  ): Promise<Review> {
    await this.limit(user.id);
    const row = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM reviews WHERE id = ${id}::uuid FOR UPDATE`;
      if (locked.length === 0) throw reviewNotFound();
      const review = await tx.review.findUniqueOrThrow({
        where: { id },
        include: { job: { select: { providerId: true } } },
      });
      // Someone else's review looks exactly like a missing one.
      if (review.authorId !== user.id) throw reviewNotFound();
      if (!isEditable(review)) {
        throw conflict(
          'REVIEW_NOT_EDITABLE',
          review.status === 'PUBLISHED'
            ? 'Değerlendirme yalnızca ilk 30 gün içinde düzenlenebilir.'
            : 'Bu değerlendirme incelemede olduğu için düzenlenemez.',
          { status: review.status },
        );
      }
      const data = {
        ...(input.rating !== undefined ? { rating: input.rating } : {}),
        ...(input.qualityRating !== undefined ? { qualityRating: input.qualityRating } : {}),
        ...(input.communicationRating !== undefined
          ? { communicationRating: input.communicationRating }
          : {}),
        ...(input.punctualityRating !== undefined
          ? { punctualityRating: input.punctualityRating }
          : {}),
        ...(input.valueRating !== undefined ? { priceRating: input.valueRating } : {}),
        ...(input.comment !== undefined ? { comment: input.comment } : {}),
      };
      const updated = await tx.review.update({ where: { id }, data });
      await this.audit.recordIn(tx, {
        action: 'review.updated',
        actorId: user.id,
        entityType: 'review',
        entityId: id,
        ipAddress,
        metadata: {
          jobId: review.jobId,
          previous: {
            rating: review.rating,
            qualityRating: review.qualityRating,
            communicationRating: review.communicationRating,
            punctualityRating: review.punctualityRating,
            valueRating: review.priceRating,
            comment: review.comment,
          },
          changed: Object.keys(input),
        },
      });
      if (data.rating !== undefined && data.rating !== review.rating) {
        await this.quality.recalculateIn(tx, [review.job.providerId]);
      }
      return updated;
    });
    return toReview(row);
  }

  /**
   * Published reviews of a publicly listed provider, with masked author
   * names and the provider's reply. Sort NEWEST (id desc; ids are
   * time-ordered), HIGHEST (rating desc, then newest) or LOWEST (rating
   * asc, then newest); optional star filter. `cursor` is the last review
   * id of the previous page (keyset, stable with the id tiebreak); `page`
   * (offset) is still accepted when no cursor is sent.
   */
  async listForProvider(
    providerId: string,
    query: ListProviderReviewsQuery,
  ): Promise<Paginated<PublicReview>> {
    const provider = await this.publicProvider(providerId);
    const base: Prisma.ReviewWhereInput = {
      ...publishedReviewsWhere(provider.userId),
      ...(query.rating !== undefined ? { rating: query.rating } : {}),
    };
    let after: Prisma.ReviewWhereInput = {};
    if (query.cursor) {
      const c = await this.prisma.review.findFirst({
        where: { id: query.cursor, targetId: provider.userId },
        select: { id: true, rating: true },
      });
      if (!c) throw badRequest('INVALID_CURSOR', 'Sayfa bilgisi geçersiz.');
      after =
        query.sort === 'NEWEST'
          ? { id: { lt: c.id } }
          : {
              OR: [
                { rating: query.sort === 'HIGHEST' ? { lt: c.rating } : { gt: c.rating } },
                { rating: c.rating, id: { lt: c.id } },
              ],
            };
    }
    const orderBy: Prisma.ReviewOrderByWithRelationInput[] =
      query.sort === 'NEWEST'
        ? [{ id: 'desc' }]
        : [{ rating: query.sort === 'HIGHEST' ? 'desc' : 'asc' }, { id: 'desc' }];
    const rows = await this.prisma.review.findMany({
      where: { AND: [base, after] },
      include: publicReviewInclude,
      orderBy,
      skip: query.cursor ? 0 : query.page * query.limit,
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toPublicReview),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /** Star counts of a listed provider's published reviews. */
  async distribution(providerId: string): Promise<ReviewDistribution> {
    const provider = await this.publicProvider(providerId);
    return reviewDistributionOf(this.prisma, provider.userId);
  }

  /**
   * The reviewed provider's one public answer (Faz 7). Only for a published
   * review about them; a second answer is a 409. Plain text (schema). The
   * review itself is never changed. Audited; the customer is notified.
   */
  async reply(
    user: AuthUser,
    reviewId: string,
    input: ReplyToReview,
    ipAddress: string | null,
  ): Promise<ProviderReviewReply> {
    await this.limit(user.id);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM reviews WHERE id = ${reviewId}::uuid FOR UPDATE`;
        if (locked.length === 0) throw reviewNotFound();
        const review = await tx.review.findUniqueOrThrow({
          where: { id: reviewId },
          include: {
            reply: { select: { reviewId: true } },
            job: { select: { id: true, providerId: true } },
          },
        });
        // Someone else's review looks exactly like a missing one.
        if (review.direction !== 'CUSTOMER_TO_PROVIDER' || review.targetId !== user.id) {
          throw reviewNotFound();
        }
        if (review.status !== 'PUBLISHED') {
          throw conflict(
            'REVIEW_NOT_REPLYABLE',
            'Yalnızca yayındaki değerlendirmelere cevap verilebilir.',
            { status: review.status },
          );
        }
        if (review.reply) throw replyExists();
        const reply = await tx.providerReviewReply.create({
          data: { reviewId, authorId: user.id, body: input.body },
        });
        await this.audit.recordIn(tx, {
          action: 'review.replied',
          actorId: user.id,
          entityType: 'review',
          entityId: reviewId,
          ipAddress,
          metadata: { jobId: review.job.id, providerId: review.job.providerId },
        });
        await this.notifications.enqueueIn(tx, [
          {
            userId: review.authorId,
            type: NotificationEvent.REVIEW_REPLIED,
            title: 'Usta değerlendirmenize cevap verdi',
            body: reply.body.length > 140 ? `${reply.body.slice(0, 139)}…` : reply.body,
            data: { jobId: review.job.id, reviewId },
          },
        ]);
        return { body: reply.body, createdAt: reply.createdAt.toISOString() };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw replyExists();
      }
      throw error;
    }
  }

  private async publicProvider(providerId: string): Promise<{ userId: string }> {
    const provider = await this.prisma.providerProfile.findFirst({
      where: { id: providerId, ...publiclyListedProviderWhere },
      select: { userId: true },
    });
    if (!provider) throw notFound('PROVIDER_NOT_FOUND', 'Usta bulunamadı.');
    return provider;
  }

  private limit(userId: string): Promise<void> {
    return this.rateLimit.enforce({
      bucket: 'review-write',
      subject: userId,
      limit: REVIEW_WRITE_LIMIT,
      windowSeconds: REVIEW_WRITE_WINDOW_SECONDS,
    });
  }
}
