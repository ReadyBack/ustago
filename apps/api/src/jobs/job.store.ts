import { Injectable } from '@nestjs/common';

import type { Job, Prisma } from '../generated/prisma/client.js';
import type { JobParty } from './domain/job-state-machine.js';
import { jobNotFound } from './job-errors.js';

type Tx = Prisma.TransactionClient;

export interface LockedJob {
  job: Job;
  party: JobParty;
  customerUserId: string;
  providerUserId: string;
  providerName: string;
  title: string;
}

/**
 * Loads a job for a mutation with its row locked (SELECT … FOR UPDATE).
 * Every job mutation locks the job row first, then any change order row:
 * one lock order everywhere, so concurrent actions serialise instead of
 * deadlocking. Non-participants get the same 404 as a missing job.
 */
@Injectable()
export class JobStore {
  async lockForParty(tx: Tx, jobId: string, userId: string): Promise<LockedJob> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM jobs WHERE id = ${jobId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw jobNotFound();
    const job = await tx.job.findUniqueOrThrow({
      where: { id: jobId },
      include: {
        customer: { select: { userId: true } },
        provider: { select: { userId: true, displayName: true } },
        serviceRequest: { select: { title: true } },
      },
    });
    const party: JobParty | null =
      job.customer.userId === userId
        ? 'CUSTOMER'
        : job.provider.userId === userId
          ? 'PROVIDER'
          : null;
    if (!party) throw jobNotFound();
    const { customer, provider, serviceRequest, ...row } = job;
    return {
      job: row,
      party,
      customerUserId: customer.userId,
      providerUserId: provider.userId,
      providerName: provider.displayName,
      title: serviceRequest.title,
    };
  }
}
