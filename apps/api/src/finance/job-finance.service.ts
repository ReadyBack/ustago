import { Injectable } from '@nestjs/common';
import type { DisputeFinancialAction } from '@ustago/validation';

import { unprocessable } from '../common/http/errors.js';
import type { JobActor, Prisma } from '../generated/prisma/client.js';
import { CAPTURED_PAYMENT_STATUSES } from './domain/payment-state.js';
import { refundableAmount } from './domain/refund.js';
import { EarningsService } from './earnings.service.js';
import { refundExceeds } from './finance-errors.js';
import { PaymentsService } from './payments.service.js';
import { RefundsService } from './refunds.service.js';

type Tx = Prisma.TransactionClient;

/** Work a job transaction leaves for after its commit (provider calls). */
export interface AfterCommit {
  refundIds: string[];
  cancelledPayments: Awaited<ReturnType<PaymentsService['cancelInFlight']>>;
}

export const emptyAfterCommit = (): AfterCommit => ({ refundIds: [], cancelledPayments: [] });

/**
 * The seam between the job lifecycle (Faz 4) and money (Faz 5). The job
 * services call these hooks inside their own transaction, after they have
 * locked the job row; provider calls happen after commit via `finish`.
 * Job states and payment states stay separate: a COMPLETED job is not a
 * paid job, and a payment never moves a job.
 */
@Injectable()
export class JobFinanceService {
  constructor(
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
    private readonly earnings: EarningsService,
  ) {}

  onCompleted(tx: Tx, jobId: string, now: Date): Promise<void> {
    return this.earnings.onJobCompleted(tx, jobId, now);
  }

  onDisputed(tx: Tx, jobId: string, now: Date): Promise<void> {
    return this.earnings.onJobDisputed(tx, jobId, now);
  }

  /**
   * Cancellation (only possible before the provider set off, Faz 4): an
   * unfinished online payment is withdrawn and captured money is refunded
   * in full ("eligible cancellation → full refund"). After work started
   * there is no cancellation; money questions go through a dispute.
   */
  async onCancelled(tx: Tx, jobId: string, actor: JobActor, now: Date): Promise<AfterCommit> {
    const after = emptyAfterCommit();
    after.cancelledPayments = await this.payments.cancelInFlight(tx, jobId, now);
    const captured = await tx.payment.findMany({
      where: { jobId, status: { in: [...CAPTURED_PAYMENT_STATUSES] } },
      select: { id: true, amountMinor: true },
    });
    for (const p of captured) {
      const totals = await this.refunds.refundTotals(tx, p.id);
      const rest = refundableAmount(p.amountMinor, totals.nonFailed);
      if (rest <= 0n) continue;
      const refund = await this.refunds.requestInTx(tx, {
        paymentId: p.id,
        amount: rest,
        reason: 'JOB_CANCELLED',
        note: `İş başlamadan iptal edildi (${actor === 'CUSTOMER' ? 'müşteri' : 'usta'}); tam iade.`,
        requestedById: null,
        idempotencyKey: `system:job-cancelled:${p.id}`,
        now,
      });
      after.refundIds.push(refund.id);
    }
    return after;
  }

  /**
   * Admin's financial decision on a dispute. The caller holds the dispute
   * lock; this locks the job. Required whenever the job has money held.
   */
  async resolveDispute(
    tx: Tx,
    input: {
      jobId: string;
      action: DisputeFinancialAction | undefined;
      adminId: string;
      note: string;
      now: Date;
    },
  ): Promise<AfterCommit> {
    const after = emptyAfterCommit();
    await tx.$queryRaw`SELECT id FROM jobs WHERE id = ${input.jobId}::uuid FOR UPDATE`;
    const payments = await tx.payment.findMany({
      where: { jobId: input.jobId, status: { in: [...CAPTURED_PAYMENT_STATUSES] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, amountMinor: true },
    });
    const unreleased = await tx.providerEarning.findMany({
      where: { jobId: input.jobId, status: { in: ['HELD', 'PENDING'] } },
      select: { id: true },
    });
    const refundable: { id: string; rest: bigint }[] = [];
    for (const p of payments) {
      const totals = await this.refunds.refundTotals(tx, p.id);
      refundable.push({ id: p.id, rest: refundableAmount(p.amountMinor, totals.nonFailed) });
    }
    const totalRefundable = refundable.reduce((a, r) => a + r.rest, 0n);
    const action = input.action?.type ?? 'NO_FINANCIAL_ACTION';
    if (action === 'NO_FINANCIAL_ACTION') {
      if (unreleased.length > 0) {
        throw unprocessable(
          'DISPUTE_FINANCIAL_ACTION_REQUIRED',
          'Bu işte bekletilen ödeme var: iade veya ustaya aktarım kararı seçin.',
          { refundableMinor: Number(totalRefundable) },
        );
      }
      return after;
    }
    if (action === 'RELEASE_PROVIDER_FUNDS') {
      for (const e of unreleased) {
        await this.earnings.releaseByAdmin(tx, e.id, input.adminId, input.now);
      }
      return after;
    }
    let toRefund =
      action === 'FULL_CUSTOMER_REFUND'
        ? totalRefundable
        : BigInt(input.action?.refundAmountMinor ?? 0);
    if (toRefund <= 0n || toRefund > totalRefundable) throw refundExceeds(Number(totalRefundable));
    // Newest payment first (e.g. the change-order difference).
    for (const r of refundable) {
      if (toRefund === 0n) break;
      const amount = r.rest < toRefund ? r.rest : toRefund;
      if (amount <= 0n) continue;
      const refund = await this.refunds.requestInTx(tx, {
        paymentId: r.id,
        amount,
        reason: 'DISPUTE_RESOLUTION',
        note: input.note.slice(0, 1000),
        requestedById: input.adminId,
        idempotencyKey: `dispute-resolution:${r.id}:${input.now.getTime()}`,
        now: input.now,
      });
      after.refundIds.push(refund.id);
      toRefund -= amount;
    }
    // What was not refunded goes to the provider.
    const stillHeld = await tx.providerEarning.findMany({
      where: { jobId: input.jobId, status: { in: ['HELD', 'PENDING'] } },
      select: { id: true },
    });
    for (const e of stillHeld) {
      await this.earnings.releaseByAdmin(tx, e.id, input.adminId, input.now);
    }
    return after;
  }

  /** Provider calls after the job transaction committed. */
  async finish(after: AfterCommit): Promise<void> {
    await this.payments.cancelAtProvider(after.cancelledPayments);
    await this.refunds.processAll(after.refundIds);
  }
}
