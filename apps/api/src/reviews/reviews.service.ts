import { Injectable } from '@nestjs/common';
import type { Paginated, PublicReview, Review } from '@ustago/types';
import {
  type CreateReview,
  type ListProviderReviewsQuery,
  maskPersonName,
  type UpdateReview,
} from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { conflict, forbidden, notFound } from '../common/http/errors.js';
import { Prisma } from '../generated/prisma/client.js';
import { toReview } from '../jobs/job.mappers.js';
import { JobStore } from '../jobs/job.store.js';
import { NotificationEvent } from '../notifications/notification-events.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { QualityService } from '../quality/quality.service.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { isEditable, reviewEligibility } from './domain/review-policy.js';

/** Review writes per user per hour: generous for real use, a wall for scripts. */
const REVIEW_WRITE_LIMIT = 20;
const REVIEW_WRITE_WINDOW_SECONDS = 3600;

const reviewNotFound = () => notFound('REVIEW_NOT_FOUND', 'Değerlendirme bulunamadı.');
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

  /** Published reviews of an ACTIVE provider, newest first, with masked author names. */
  async listForProvider(
    providerId: string,
    query: ListProviderReviewsQuery,
  ): Promise<Paginated<PublicReview>> {
    const provider = await this.prisma.providerProfile.findFirst({
      where: { id: providerId, status: 'ACTIVE', deletedAt: null },
      select: { userId: true },
    });
    if (!provider) throw notFound('PROVIDER_NOT_FOUND', 'Usta bulunamadı.');
    const rows = await this.prisma.review.findMany({
      where: {
        targetId: provider.userId,
        direction: 'CUSTOMER_TO_PROVIDER',
        status: 'PUBLISHED',
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      include: {
        author: { select: { firstName: true, lastName: true } },
        job: { select: { category: { select: { name: true } } } },
        reply: { select: { body: true, createdAt: true } },
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((r) => ({
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
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
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
