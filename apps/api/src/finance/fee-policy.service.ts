import { Injectable } from '@nestjs/common';

import type { PlatformFeePolicy, Prisma } from '../generated/prisma/client.js';
import type { FeePolicy } from './domain/fee.js';
import { feePolicyMissing } from './finance-errors.js';

type Tx = Prisma.TransactionClient;

export interface FeeSnapshot extends FeePolicy {
  policyId: string;
  isDevelopment: boolean;
}

const toSnapshot = (p: PlatformFeePolicy): FeeSnapshot => ({
  policyId: p.id,
  bps: p.bps,
  fixedFeeMinor: p.fixedFeeMinor,
  minFeeMinor: p.minFeeMinor,
  maxFeeMinor: p.maxFeeMinor,
  isDevelopment: p.isDevelopment,
});

/**
 * Platform fee policy (docs/adr/0020). Policies are immutable, versioned
 * rows; a job keeps the policy that was in force when the deal was made,
 * so tomorrow's %18 never changes yesterday's %15 job.
 */
@Injectable()
export class FeePolicyService {
  /** The policy in force at `at`, or null when none is configured. */
  async activeAt(tx: Tx, at: Date): Promise<PlatformFeePolicy | null> {
    return tx.platformFeePolicy.findFirst({
      where: { currency: 'TRY', effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /** Written when the job is created (quote accept). Missing policy: left null. */
  async snapshotOnCreate(tx: Tx, jobId: string, at: Date): Promise<void> {
    const policy = await this.activeAt(tx, at);
    if (!policy) return;
    await tx.job.updateMany({
      where: { id: jobId, platformFeePolicyId: null },
      data: { platformFeePolicyId: policy.id, platformFeeBps: policy.bps },
    });
  }

  /**
   * The job's snapshot; jobs from before Faz 5 get one on their first
   * financial event (conditional update, so it is written once). The
   * caller holds the job row lock.
   */
  async forJob(tx: Tx, jobId: string, now: Date): Promise<FeeSnapshot> {
    const job = await tx.job.findUniqueOrThrow({
      where: { id: jobId },
      select: { feePolicy: true, createdAt: true },
    });
    if (job.feePolicy) return toSnapshot(job.feePolicy);
    const policy = (await this.activeAt(tx, job.createdAt)) ?? (await this.activeAt(tx, now));
    if (!policy) throw feePolicyMissing();
    await tx.job.updateMany({
      where: { id: jobId, platformFeePolicyId: null },
      data: { platformFeePolicyId: policy.id, platformFeeBps: policy.bps },
    });
    return toSnapshot(policy);
  }

  /** Read-only variant for summaries (never writes). */
  async peekForJob(tx: Tx, jobId: string, now: Date): Promise<FeeSnapshot | null> {
    const job = await tx.job.findUniqueOrThrow({
      where: { id: jobId },
      select: { feePolicy: true, createdAt: true },
    });
    if (job.feePolicy) return toSnapshot(job.feePolicy);
    const policy = (await this.activeAt(tx, job.createdAt)) ?? (await this.activeAt(tx, now));
    return policy ? toSnapshot(policy) : null;
  }
}
