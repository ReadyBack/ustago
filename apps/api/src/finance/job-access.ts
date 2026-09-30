import type { Job, Prisma } from '../generated/prisma/client.js';
import { jobNotFound } from '../jobs/job-errors.js';

type Tx = Prisma.TransactionClient;

export interface JobParties {
  job: Job;
  party: 'CUSTOMER' | 'PROVIDER';
  customerUserId: string;
  providerUserId: string;
  providerName: string;
  customerName: string;
  title: string;
}

/**
 * Loads a job for one of its two parties; anyone else gets the same 404 as
 * a missing job (no existence leak). With `lock`, the job row is locked
 * first (SELECT … FOR UPDATE), the first lock of every finance write.
 */
export async function jobForParty(
  tx: Tx,
  jobId: string,
  userId: string,
  lock: boolean,
): Promise<JobParties> {
  if (lock) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM jobs WHERE id = ${jobId}::uuid FOR UPDATE`;
    if (rows.length === 0) throw jobNotFound();
  }
  const job = await tx.job.findUnique({
    where: { id: jobId },
    include: {
      customer: { select: { userId: true, user: { select: { firstName: true, lastName: true } } } },
      provider: { select: { userId: true, displayName: true } },
      serviceRequest: { select: { title: true } },
    },
  });
  if (!job) throw jobNotFound();
  const party =
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
    customerName: `${customer.user.firstName} ${customer.user.lastName}`.trim(),
    title: serviceRequest.title,
  };
}

export async function lockJob(tx: Tx, jobId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM jobs WHERE id = ${jobId}::uuid FOR UPDATE`;
}
