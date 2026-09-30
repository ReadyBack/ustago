import { Injectable } from '@nestjs/common';
import type {
  AdminDisputeDetail,
  AdminDisputeListItem,
  AdminJobDetail,
  AdminJobListItem,
  AdminReview,
  JobActor,
  Paginated,
} from '@ustago/types';
import {
  type ListAdminDisputesQuery,
  type ListAdminJobsQuery,
  type ListAdminReviewsQuery,
  maskPersonName,
  maskPhone,
  type ModerateReview,
  type ResolveDispute,
} from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import { conflict, notFound } from '../common/http/errors.js';
import { toMoney, toMoneyOrNull } from '../common/money.js';
import type { Prisma } from '../generated/prisma/client.js';
import { JobFinanceService } from '../finance/job-finance.service.js';
import { buildTimeline } from '../jobs/domain/job-state-machine.js';
import { OPEN_DISPUTE_STATUSES, toChangeOrder } from '../jobs/job.mappers.js';
import { NotificationEvent } from '../notifications/notification-events.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { QualityService } from '../quality/quality.service.js';
import { toQuoteRevision } from '../quotes/quote.mappers.js';
import {
  categoryRefSelect,
  fullName,
  toCategoryRef,
  toLocation,
} from '../service-requests/service-request.mappers.js';

const RESOLVED_DISPUTE_STATUSES = [
  'RESOLVED_FOR_CUSTOMER',
  'RESOLVED_FOR_PROVIDER',
  'RESOLVED_PARTIAL',
  'CLOSED',
] as const;

const JOB_ACTORS: readonly string[] = ['CUSTOMER', 'PROVIDER', 'ADMIN', 'SYSTEM'];

const jobListInclude = {
  category: { select: categoryRefSelect },
  serviceRequest: {
    select: {
      type: true,
      title: true,
      province: { select: { id: true, name: true } },
      district: { select: { id: true, name: true } },
    },
  },
  customer: { select: { user: { select: { id: true, firstName: true, lastName: true } } } },
  provider: { select: { id: true, displayName: true } },
} satisfies Prisma.JobInclude;

type JobListRow = Prisma.JobGetPayload<{ include: typeof jobListInclude }>;

const reviewInclude = {
  author: { select: { firstName: true, lastName: true } },
  job: { select: { provider: { select: { id: true, displayName: true } } } },
} satisfies Prisma.ReviewInclude;

type ReviewRow = Prisma.ReviewGetPayload<{ include: typeof reviewInclude }>;

const disputeInclude = {
  job: {
    select: {
      id: true,
      status: true,
      serviceRequest: { select: { title: true } },
      provider: { select: { id: true, displayName: true } },
    },
  },
  openedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.DisputeInclude;

type DisputeRow = Prisma.DisputeGetPayload<{ include: typeof disputeInclude }>;

const disputeNotFound = () => notFound('DISPUTE_NOT_FOUND', 'Sorun bildirimi bulunamadı.');
const reviewNotFound = () => notFound('REVIEW_NOT_FOUND', 'Değerlendirme bulunamadı.');

function toAdminJobListItem(j: JobListRow): AdminJobListItem {
  return {
    id: j.id,
    status: j.status,
    requestType: j.serviceRequest.type,
    title: j.serviceRequest.title,
    category: toCategoryRef(j.category),
    location: toLocation(j.serviceRequest),
    customer: { id: j.customer.user.id, name: fullName(j.customer.user) },
    provider: { id: j.provider.id, displayName: j.provider.displayName },
    agreedPrice: toMoney(j.agreedPriceMinor, j.currency),
    currentTotal: toMoney(j.currentTotalMinor, j.currency),
    createdAt: j.createdAt.toISOString(),
  };
}

function toAdminReview(r: ReviewRow): AdminReview {
  return {
    id: r.id,
    status: r.status,
    rating: r.rating,
    qualityRating: r.qualityRating,
    communicationRating: r.communicationRating,
    punctualityRating: r.punctualityRating,
    valueRating: r.priceRating,
    comment: r.comment,
    jobId: r.jobId,
    provider: { id: r.job.provider.id, displayName: r.job.provider.displayName },
    customerName: maskPersonName(r.author.firstName, r.author.lastName),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    moderatedAt: r.moderatedAt?.toISOString() ?? null,
    moderationReason: r.moderationReason,
  };
}

function toAdminDispute(d: DisputeRow): AdminDisputeListItem {
  return {
    id: d.id,
    status: d.status,
    reason: d.reason,
    job: { id: d.job.id, title: d.job.serviceRequest.title, status: d.job.status },
    customer: { id: d.openedBy.id, name: fullName(d.openedBy) },
    provider: { id: d.job.provider.id, displayName: d.job.provider.displayName },
    createdAt: d.createdAt.toISOString(),
    resolvedAt: d.resolvedAt?.toISOString() ?? null,
  };
}

function actorOf(metadata: Prisma.JsonValue | null): JobActor | null {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const actor = metadata.actor;
    if (typeof actor === 'string' && JOB_ACTORS.includes(actor)) return actor as JobActor;
  }
  return null;
}

/**
 * Admin views of jobs, disputes and reviews (Faz 4) and the two admin
 * decisions there: resolving a dispute and hiding / restoring a review.
 * Both are audited and rescore the provider in the same transaction.
 * Personal data is kept to what a decision needs (masked phone, no
 * address line).
 */
@Injectable()
export class AdminJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly quality: QualityService,
    private readonly jobFinance: JobFinanceService,
  ) {}

  // -------------------------------------------------------------------------
  // Jobs
  // -------------------------------------------------------------------------

  async listJobs(query: ListAdminJobsQuery): Promise<Paginated<AdminJobListItem>> {
    const rows = await this.prisma.job.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.providerId ? { providerId: query.providerId } : {}),
        ...(query.customerId ? { customer: { userId: query.customerId } } : {}),
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.provinceId ? { serviceRequest: { provinceId: query.provinceId } } : {}),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lt: new Date(query.to) } : {}),
              },
            }
          : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      include: jobListInclude,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toAdminJobListItem),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async job(id: string): Promise<AdminJobDetail> {
    const job = await this.prisma.job.findUnique({
      where: { id },
      include: {
        ...jobListInclude,
        serviceRequest: {
          select: {
            id: true,
            type: true,
            title: true,
            description: true,
            budgetMinor: true,
            currency: true,
            province: { select: { id: true, name: true } },
            district: { select: { id: true, name: true } },
            address: { select: { neighborhood: true } },
          },
        },
        customer: {
          select: { user: { select: { id: true, firstName: true, lastName: true, phone: true } } },
        },
        quote: { select: { revisions: { orderBy: { revisionNo: 'asc' } } } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
        changeOrders: { orderBy: { createdAt: 'asc' } },
        reviews: { where: { direction: 'CUSTOMER_TO_PROVIDER' }, include: reviewInclude },
        disputes: { orderBy: { createdAt: 'desc' }, include: disputeInclude },
      },
    });
    if (!job) throw notFound('JOB_NOT_FOUND', 'İş bulunamadı.');
    const [reviewIds, disputeIds] = [job.reviews.map((r) => r.id), job.disputes.map((d) => d.id)];
    const audit = await this.prisma.auditLog.findMany({
      where: {
        OR: [
          { entityType: 'job', entityId: id },
          ...(reviewIds.length > 0 ? [{ entityType: 'review', entityId: { in: reviewIds } }] : []),
          ...(disputeIds.length > 0
            ? [{ entityType: 'dispute', entityId: { in: disputeIds } }]
            : []),
        ],
      },
      select: { action: true, entityType: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    const user = job.customer.user;
    const review = job.reviews[0];
    return {
      ...toAdminJobListItem(job),
      serviceRequest: {
        id: job.serviceRequest.id,
        title: job.serviceRequest.title,
        description: job.serviceRequest.description,
        budget: toMoneyOrNull(job.serviceRequest.budgetMinor, job.serviceRequest.currency),
      },
      location: {
        ...toLocation(job.serviceRequest),
        neighborhood: job.serviceRequest.address.neighborhood,
      },
      customer: {
        id: user.id,
        name: fullName(user),
        maskedPhone: user.phone ? maskPhone(user.phone) : null,
      },
      negotiation: (job.quote?.revisions ?? []).map(toQuoteRevision),
      acceptedRevisionId: job.acceptedRevisionId,
      timeline: buildTimeline(job),
      statusHistory: job.statusHistory.map((h) => ({
        from: h.fromStatus,
        to: h.toStatus,
        actor: actorOf(h.metadata),
        reason: h.reason,
        at: h.createdAt.toISOString(),
      })),
      changeOrders: job.changeOrders.map(toChangeOrder),
      review: review ? toAdminReview(review) : null,
      disputes: job.disputes.map(toAdminDispute),
      cancellation: job.cancelledAt
        ? {
            at: job.cancelledAt.toISOString(),
            actor: job.cancellationActor,
            reason: job.cancellationReason,
          }
        : null,
      audit: audit.map((a) => ({
        action: a.action,
        entityType: a.entityType,
        at: a.createdAt.toISOString(),
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Disputes
  // -------------------------------------------------------------------------

  async listDisputes(query: ListAdminDisputesQuery): Promise<Paginated<AdminDisputeListItem>> {
    const statuses =
      query.group === 'OPEN'
        ? OPEN_DISPUTE_STATUSES
        : query.group === 'RESOLVED'
          ? RESOLVED_DISPUTE_STATUSES
          : null;
    const rows = await this.prisma.dispute.findMany({
      where: {
        ...(statuses ? { status: { in: [...statuses] } } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      include: disputeInclude,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toAdminDispute),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async dispute(id: string): Promise<AdminDisputeDetail> {
    const d = await this.prisma.dispute.findUnique({
      where: { id },
      include: {
        ...disputeInclude,
        job: {
          select: {
            ...disputeInclude.job.select,
            createdAt: true,
            enRouteAt: true,
            arrivedAt: true,
            startedAt: true,
            completionRequestedAt: true,
            completedAt: true,
          },
        },
        resolvedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!d) throw disputeNotFound();
    return {
      ...toAdminDispute(d),
      description: d.description,
      resolution: d.resolution,
      resolvedBy: d.resolvedBy ? { id: d.resolvedBy.id, name: fullName(d.resolvedBy) } : null,
      timeline: buildTimeline(d.job),
    };
  }

  /**
   * Records the admin's decision. The job stays DISPUTED (there is no
   * payment to release or refund in Faz 4); the outcome is what counts
   * against or for the provider's quality score from now on.
   */
  async resolveDispute(
    adminId: string,
    id: string,
    input: ResolveDispute,
    ipAddress: string | null,
  ): Promise<AdminDisputeDetail> {
    const ref = await this.prisma.dispute.findUnique({ where: { id }, select: { jobId: true } });
    if (!ref) throw disputeNotFound();
    const after = await this.prisma.$transaction(async (tx) => {
      // Lock order everywhere: job → dispute → payment → earning → ledger accounts.
      await tx.$queryRaw`SELECT id FROM jobs WHERE id = ${ref.jobId}::uuid FOR UPDATE`;
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM disputes WHERE id = ${id}::uuid FOR UPDATE`;
      if (locked.length === 0) throw disputeNotFound();
      const d = await tx.dispute.findUniqueOrThrow({
        where: { id },
        include: {
          job: {
            select: {
              id: true,
              providerId: true,
              serviceRequest: { select: { title: true } },
            },
          },
        },
      });
      const now = new Date();
      const moved = await tx.dispute.updateMany({
        where: { id, status: { in: [...OPEN_DISPUTE_STATUSES] } },
        data: {
          status: input.outcome,
          resolution: input.note,
          resolvedById: adminId,
          resolvedAt: now,
        },
      });
      if (moved.count === 0) {
        throw conflict('DISPUTE_ALREADY_RESOLVED', 'Bu sorun bildirimi zaten sonuçlandı.', {
          status: d.status,
        });
      }
      await this.audit.recordIn(tx, {
        action: 'dispute.resolved',
        actorId: adminId,
        entityType: 'dispute',
        entityId: id,
        ipAddress,
        metadata: {
          jobId: d.job.id,
          outcome: input.outcome,
          reason: d.reason,
          financialAction: input.financialAction?.type ?? null,
        },
      });
      const data = { jobId: d.job.id, disputeId: id };
      const title = 'Sorun bildirimi sonuçlandı.';
      const body = `${d.job.serviceRequest.title}. Ayrıntılar iş sayfasında.`;
      await this.notifications.enqueueIn(tx, [
        { userId: d.openedById, type: NotificationEvent.DISPUTE_RESOLVED, title, body, data },
        { userId: d.againstId, type: NotificationEvent.DISPUTE_RESOLVED, title, body, data },
      ]);
      await this.quality.recalculateIn(tx, [d.job.providerId], now);
      // Money held for the job is decided together with the dispute.
      return this.jobFinance.resolveDispute(tx, {
        jobId: d.job.id,
        action: input.financialAction,
        adminId,
        note: input.note,
        now,
      });
    });
    await this.jobFinance.finish(after);
    return this.dispute(id);
  }

  // -------------------------------------------------------------------------
  // Reviews
  // -------------------------------------------------------------------------

  async listReviews(query: ListAdminReviewsQuery): Promise<Paginated<AdminReview>> {
    const rows = await this.prisma.review.findMany({
      where: {
        direction: 'CUSTOMER_TO_PROVIDER',
        ...(query.status ? { status: query.status } : {}),
        ...(query.providerId ? { job: { providerId: query.providerId } } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      include: reviewInclude,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toAdminReview),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  hideReview(
    adminId: string,
    id: string,
    input: ModerateReview,
    ip: string | null,
  ): Promise<AdminReview> {
    return this.moderate(adminId, id, 'HIDE', input, ip);
  }

  restoreReview(
    adminId: string,
    id: string,
    input: ModerateReview,
    ip: string | null,
  ): Promise<AdminReview> {
    return this.moderate(adminId, id, 'RESTORE', input, ip);
  }

  private async moderate(
    adminId: string,
    id: string,
    action: 'HIDE' | 'RESTORE',
    input: ModerateReview,
    ipAddress: string | null,
  ): Promise<AdminReview> {
    const from = action === 'HIDE' ? 'PUBLISHED' : 'HIDDEN';
    const to = action === 'HIDE' ? 'HIDDEN' : 'PUBLISHED';
    const row = await this.prisma.$transaction(async (tx) => {
      const review = await tx.review.findUnique({
        where: { id },
        include: { job: { select: { providerId: true } } },
      });
      if (!review) throw reviewNotFound();
      const moved = await tx.review.updateMany({
        where: { id, status: from },
        data: {
          status: to,
          moderatedAt: new Date(),
          moderatedById: adminId,
          moderationReason: input.reason,
        },
      });
      if (moved.count === 0) {
        throw conflict(
          'REVIEW_MODERATION_CONFLICT',
          action === 'HIDE' ? 'Değerlendirme zaten gizli.' : 'Değerlendirme zaten yayında.',
          { status: review.status },
        );
      }
      await this.audit.recordIn(tx, {
        action: action === 'HIDE' ? 'review.hidden' : 'review.restored',
        actorId: adminId,
        entityType: 'review',
        entityId: id,
        ipAddress,
        metadata: { jobId: review.jobId, reason: input.reason },
      });
      await this.quality.recalculateIn(tx, [review.job.providerId]);
      return tx.review.findUniqueOrThrow({ where: { id }, include: reviewInclude });
    });
    return toAdminReview(row);
  }
}
