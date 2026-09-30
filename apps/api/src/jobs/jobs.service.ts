import { Injectable } from '@nestjs/common';
import type { Job, JobListItem, Paginated } from '@ustago/types';
import type { ListJobsQuery } from '@ustago/validation';

import { notFound } from '../common/http/errors.js';
import { toMoney } from '../common/money.js';
import type { Job as JobRow, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toQuoteRevision } from '../quotes/quote.mappers.js';
import {
  categoryRefSelect,
  fullName,
  toCategoryRef,
  toLocation,
  toServiceAddress,
} from '../service-requests/service-request.mappers.js';
import { type AcceptedDeal, jobFromAcceptedDeal } from './domain/job-creation.js';

type Tx = Prisma.TransactionClient;

const jobNotFound = () => notFound('JOB_NOT_FOUND', 'İş bulunamadı.');

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
  customer: { select: { user: { select: { id: true, firstName: true, lastName: true, phone: true } } } },
  provider: {
    select: { id: true, displayName: true, user: { select: { id: true, phone: true } } },
  },
} satisfies Prisma.JobInclude;

const listInclude = {
  category: { select: categoryRefSelect },
  serviceRequest: {
    select: {
      title: true,
      province: { select: { id: true, name: true } },
      district: { select: { id: true, name: true } },
    },
  },
  customer: { select: { user: { select: { firstName: true, lastName: true } } } },
  provider: { select: { displayName: true } },
} satisfies Prisma.JobInclude;

/**
 * Jobs (docs/adr/0008, 0014). Created only inside the accept transaction;
 * visible to exactly two users, its customer and its provider. Once they
 * agreed, each side sees what it needs to meet: the full address and the
 * other side's name and phone. Status changes (en route, start, complete)
 * come with Faz 7's job state machine.
 */
@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Writes the job and its first status-history row. */
  async createIn(tx: Tx, deal: AcceptedDeal, actorUserId: string): Promise<JobRow> {
    const job = await tx.job.create({ data: jobFromAcceptedDeal(deal) });
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
    return {
      id: job.id,
      status: job.status,
      agreedPrice: toMoney(job.agreedPriceMinor, job.currency),
      currentTotal: toMoney(job.currentTotalMinor, job.currency),
      scheduledStartAt: job.scheduledStartAt?.toISOString() ?? null,
      createdAt: job.createdAt.toISOString(),
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
    const rows = await this.prisma.job.findMany({
      where: {
        ...(query.role === 'CUSTOMER' ? { customer: { userId } } : { provider: { userId } }),
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
        agreedPrice: toMoney(j.agreedPriceMinor, j.currency),
        title: j.serviceRequest.title,
        category: toCategoryRef(j.category),
        location: toLocation(j.serviceRequest),
        counterpart:
          query.role === 'CUSTOMER' ? j.provider.displayName : fullName(j.customer.user),
        scheduledStartAt: j.scheduledStartAt?.toISOString() ?? null,
        createdAt: j.createdAt.toISOString(),
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }
}
