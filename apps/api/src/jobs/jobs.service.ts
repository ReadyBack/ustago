import { Injectable } from '@nestjs/common';
import type { Job, JobListItem, Paginated } from '@ustago/types';
import type { ListJobsQuery } from '@ustago/validation';

import { toMoney } from '../common/money.js';
import type { Job as JobRow, JobStatus, Prisma } from '../generated/prisma/client.js';
import { FeePolicyService } from '../finance/fee-policy.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toQuoteRevision } from '../quotes/quote.mappers.js';
import { editableUntil } from '../reviews/domain/review-policy.js';
import {
  categoryRefSelect,
  fullName,
  toCategoryRef,
  toLocation,
  toServiceAddress,
} from '../service-requests/service-request.mappers.js';
import { type AcceptedDeal, jobFromAcceptedDeal } from './domain/job-creation.js';
import {
  ACTIVE_JOB_STATUSES,
  availableActions,
  buildTimeline,
  FINISHED_JOB_STATUSES,
} from './domain/job-state-machine.js';
import { jobNotFound } from './job-errors.js';
import { OPEN_DISPUTE_STATUSES, toChangeOrder, toJobDispute, toReview } from './job.mappers.js';

type Tx = Prisma.TransactionClient;

const jobInclude = {
  category: { select: categoryRefSelect },
  acceptedRevision: true,
  serviceRequest: {
    select: {
      id: true,
      type: true,
      title: true,
      description: true,
      address: {
        include: {
          province: { select: { id: true, name: true } },
          district: { select: { id: true, name: true } },
        },
      },
    },
  },
  customer: {
    select: { user: { select: { id: true, firstName: true, lastName: true, phone: true } } },
  },
  provider: {
    select: { id: true, displayName: true, user: { select: { id: true, phone: true } } },
  },
  changeOrders: { orderBy: { createdAt: 'asc' } },
  reviews: { where: { direction: 'CUSTOMER_TO_PROVIDER' } },
  disputes: { orderBy: { createdAt: 'desc' }, take: 1 },
} satisfies Prisma.JobInclude;

const listInclude = {
  category: { select: categoryRefSelect },
  serviceRequest: {
    select: {
      type: true,
      title: true,
      province: { select: { id: true, name: true } },
      district: { select: { id: true, name: true } },
    },
  },
  customer: { select: { user: { select: { firstName: true, lastName: true } } } },
  provider: { select: { displayName: true } },
} satisfies Prisma.JobInclude;

const SCOPES: Record<ListJobsQuery['scope'], readonly JobStatus[] | null> = {
  ALL: null,
  ACTIVE: ACTIVE_JOB_STATUSES,
  FINISHED: FINISHED_JOB_STATUSES,
};

/**
 * Jobs (docs/adr/0008, 0014, 0015). Created only inside the accept
 * transaction; visible to exactly two users, its customer and its
 * provider. Once they agreed, each side sees what it needs to meet: the
 * full address and the other side's name and phone. Status changes go
 * through JobLifecycleService and the job state machine.
 */
@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly feePolicy: FeePolicyService,
  ) {}

  /** Writes the job and its first status-history row. */
  async createIn(tx: Tx, deal: AcceptedDeal, actorUserId: string): Promise<JobRow> {
    // Faz 5: the platform fee policy in force now is frozen on the job.
    const policy = await this.feePolicy.activeAt(tx, new Date());
    const job = await tx.job.create({
      data: {
        ...jobFromAcceptedDeal(deal),
        ...(policy ? { platformFeePolicyId: policy.id, platformFeeBps: policy.bps } : {}),
      },
    });
    await tx.jobStatusHistory.create({
      data: {
        jobId: job.id,
        fromStatus: null,
        toStatus: job.status,
        actorUserId,
        reason: 'quote_accepted',
        metadata: { quoteId: deal.quote.id, revisionId: deal.revision.id },
      },
    });
    return job;
  }

  async get(userId: string, jobId: string): Promise<Job> {
    const job = await this.prisma.job.findFirst({
      where: {
        id: jobId,
        OR: [{ customer: { userId } }, { provider: { userId } }],
      },
      include: jobInclude,
    });
    if (!job) throw jobNotFound();
    const viewerRole = job.customer.user.id === userId ? 'CUSTOMER' : 'PROVIDER';
    const review = job.reviews[0] ?? null;
    const dispute = job.disputes[0] ?? null;
    const actions = availableActions(
      {
        status: job.status,
        hasPendingChangeOrder: job.changeOrders.some((c) => c.status === 'PENDING'),
        hasOpenDispute:
          dispute !== null && (OPEN_DISPUTE_STATUSES as readonly string[]).includes(dispute.status),
        review: {
          exists: review !== null,
          editableUntil:
            review && review.status === 'PUBLISHED' ? editableUntil(review.createdAt) : null,
        },
      },
      viewerRole,
    );
    return {
      id: job.id,
      status: job.status,
      agreedPrice: toMoney(job.agreedPriceMinor, job.currency),
      currentTotal: toMoney(job.currentTotalMinor, job.currency),
      scheduledStartAt: job.scheduledStartAt?.toISOString() ?? null,
      createdAt: job.createdAt.toISOString(),
      enRouteAt: job.enRouteAt?.toISOString() ?? null,
      arrivedAt: job.arrivedAt?.toISOString() ?? null,
      startedAt: job.startedAt?.toISOString() ?? null,
      completionRequestedAt: job.completionRequestedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
      disputedAt: job.disputedAt?.toISOString() ?? null,
      cancelledAt: job.cancelledAt?.toISOString() ?? null,
      cancellationActor: job.cancellationActor,
      cancellationReason: job.cancellationReason,
      timeline: buildTimeline(job),
      changeOrders: job.changeOrders.map(toChangeOrder),
      review: review ? toReview(review) : null,
      dispute: dispute ? toJobDispute(dispute) : null,
      actions,
      serviceRequest: {
        id: job.serviceRequest.id,
        type: job.serviceRequest.type,
        title: job.serviceRequest.title,
        description: job.serviceRequest.description,
      },
      category: toCategoryRef(job.category),
      address: toServiceAddress(job.serviceRequest.address),
      provider: {
        id: job.provider.id,
        displayName: job.provider.displayName,
        phone: job.provider.user.phone,
      },
      customer: { name: fullName(job.customer.user), phone: job.customer.user.phone },
      acceptedRevision: job.acceptedRevision ? toQuoteRevision(job.acceptedRevision) : null,
      viewerRole,
    };
  }

  async list(userId: string, query: ListJobsQuery): Promise<Paginated<JobListItem>> {
    const statuses = SCOPES[query.scope];
    const rows = await this.prisma.job.findMany({
      where: {
        ...(query.role === 'CUSTOMER' ? { customer: { userId } } : { provider: { userId } }),
        ...(statuses ? { status: { in: [...statuses] } } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      include: listInclude,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((j) => ({
        id: j.id,
        status: j.status,
        requestType: j.serviceRequest.type,
        agreedPrice: toMoney(j.agreedPriceMinor, j.currency),
        currentTotal: toMoney(j.currentTotalMinor, j.currency),
        title: j.serviceRequest.title,
        category: toCategoryRef(j.category),
        location: toLocation(j.serviceRequest),
        counterpart: query.role === 'CUSTOMER' ? j.provider.displayName : fullName(j.customer.user),
        scheduledStartAt: j.scheduledStartAt?.toISOString() ?? null,
        createdAt: j.createdAt.toISOString(),
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }
}
