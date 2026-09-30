import { Inject, Injectable, Logger } from '@nestjs/common';
import { formatMoney } from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import type { Prisma, Refund, RefundReason } from '../generated/prisma/client.js';
import { NotificationEvent } from '../notifications/notification-events.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { refundCompleted, refundRequested } from './domain/ledger.js';
import { isCaptured, statusAfterRefunds } from './domain/payment-state.js';
import {
  assertRefundable,
  RefundAmountError,
  refundableAmount,
  refundSource,
  splitRefund,
} from './domain/refund.js';
import { refundExceeds, refundNotAllowed } from './finance-errors.js';
import { LedgerService } from './ledger.service.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './providers/payment-provider.js';
import { redact } from './redact.js';

type Tx = Prisma.TransactionClient;

export interface RefundRequestInput {
  paymentId: string;
  amount: bigint;
  reason: RefundReason;
  note: string | null;
  requestedById: string | null;
  idempotencyKey: string;
  now: Date;
  ipAddress?: string | null;
}

/**
 * Refunds (docs/adr/0020). Two steps, like every call to an outside
 * provider:
 *  1. inside the business transaction (payment row locked): check the
 *     refundable amount, split it between fee and provider, write the
 *     refund (REQUESTED) and its ledger effect;
 *  2. after commit: ask the payment provider, then book completion — or,
 *     when the provider refuses, reverse step 1 with a REVERSAL.
 * A retry never refunds twice: the provider call carries the refund id as
 * its idempotency key, completion is a conditional update.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /** Refunded (non-failed) and still refundable amounts of a payment. */
  async refundTotals(
    db: Tx | PrismaService,
    paymentId: string,
  ): Promise<{ nonFailed: bigint; succeeded: bigint }> {
    const rows = await db.refund.groupBy({
      by: ['status'],
      where: { paymentId },
      _sum: { amountMinor: true },
    });
    const of = (s: string) => rows.find((r) => r.status === s)?._sum.amountMinor ?? 0n;
    return { nonFailed: of('REQUESTED') + of('SUCCEEDED'), succeeded: of('SUCCEEDED') };
  }

  /**
   * Step 1. The caller already holds the job row lock; this locks the
   * payment and then the earning (lock order job → payment → earning →
   * accounts).
   */
  async requestInTx(tx: Tx, input: RefundRequestInput): Promise<Refund> {
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${input.paymentId}::uuid FOR UPDATE`;
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: input.paymentId } });
    if (!isCaptured(payment.status) || !payment.providerId) throw refundNotAllowed(payment.status);
    const totals = await this.refundTotals(tx, payment.id);
    const refundable = refundableAmount(payment.amountMinor, totals.nonFailed);
    try {
      assertRefundable(input.amount, refundable);
    } catch (error) {
      if (error instanceof RefundAmountError) throw refundExceeds(Number(refundable));
      throw error;
    }
    const split = splitRefund({
      paid: payment.amountMinor,
      fee: payment.platformFeeMinor,
      refundedBefore: totals.nonFailed,
      amount: input.amount,
    });

    await tx.$queryRaw`SELECT id FROM provider_earnings WHERE payment_id = ${payment.id}::uuid FOR UPDATE`;
    const earning = await tx.providerEarning.findUniqueOrThrow({ where: { paymentId: payment.id } });
    await this.ledger.lockProvider(tx, payment.providerId);
    const released = earning.status === 'AVAILABLE';
    const pendingBalance = released ? 0n : await this.ledger.earningPendingBalance(tx, earning.id);
    const balances = await this.ledger.providerBalances(tx, payment.providerId);
    const source = refundSource({
      providerPortion: split.providerPortion,
      earningReleased: released,
      earningPendingBalance: pendingBalance,
      providerAvailable: balances.available,
    });

    const refund = await tx.refund.create({
      data: {
        paymentId: payment.id,
        jobId: payment.jobId,
        amountMinor: input.amount,
        feePortionMinor: split.feePortion,
        providerPortionMinor: split.providerPortion,
        currency: payment.currency,
        reason: input.reason,
        internalNote: input.note,
        requestedById: input.requestedById,
        idempotencyKey: input.idempotencyKey,
      },
    });
    await this.ledger.post(tx, {
      built: refundRequested({
        providerId: payment.providerId,
        amount: input.amount,
        feePortion: split.feePortion,
        source,
      }),
      sourceKey: `refund:${refund.id}:requested`,
      refs: {
        jobId: payment.jobId,
        paymentId: payment.id,
        refundId: refund.id,
        earningId: earning.id,
        providerId: payment.providerId,
      },
      description:
        source.toDebt > 0n
          ? `İade talebi; ödenmiş kazançtan ${formatMoney(Number(source.toDebt))} usta borcuna yazıldı`
          : 'İade talebi',
      createdById: input.requestedById,
    });
    if (!released && pendingBalance - source.fromPending === 0n) {
      await tx.providerEarning.update({
        where: { id: earning.id },
        data: { status: 'REVERSED', version: { increment: 1 } },
      });
    }
    const metadata = {
      paymentId: payment.id,
      jobId: payment.jobId,
      amountMinor: Number(input.amount),
      feePortionMinor: Number(split.feePortion),
      providerPortionMinor: Number(split.providerPortion),
      toProviderDebtMinor: Number(source.toDebt),
      reason: input.reason,
    };
    for (const action of ['payment.refund.requested', 'refund.created']) {
      await this.audit.recordIn(tx, {
        action,
        actorId: input.requestedById,
        entityType: 'refund',
        entityId: refund.id,
        ipAddress: input.ipAddress ?? null,
        metadata,
      });
    }
    return refund;
  }

  /** Step 2 for each refund; never throws (a failure is logged and retried by the sweep). */
  async processAll(refundIds: readonly string[]): Promise<void> {
    for (const id of refundIds) {
      try {
        await this.process(id);
      } catch (error) {
        this.logger.error(
          `Refund ${id} could not be processed; the sweep retries it`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  async process(refundId: string): Promise<void> {
    const refund = await this.prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
      include: { payment: { select: { gatewayReference: true } } },
    });
    if (refund.status !== 'REQUESTED') return;
    if (!refund.payment.gatewayReference) {
      await this.fail(refundId, 'NO_PROVIDER_REFERENCE');
      return;
    }
    const result = await this.provider.refundPayment({
      providerPaymentId: refund.payment.gatewayReference,
      refundId: refund.id,
      amountMinor: refund.amountMinor,
      currency: 'TRY',
      idempotencyKey: refund.id,
    });
    this.logger.debug(`Refund ${refund.id}: ${JSON.stringify(redact(result))}`);
    if (result.state === 'SUCCEEDED') {
      await this.complete(refund.id, result.providerRefundId);
    } else if (result.state === 'FAILED') {
      await this.fail(refund.id, result.failureCode ?? 'PROVIDER_REFUSED', result.providerRefundId);
    } else {
      // PENDING: the provider's webhook finishes it.
      await this.prisma.refund.updateMany({
        where: { id: refund.id, gatewayRefundId: null },
        data: { gatewayRefundId: result.providerRefundId },
      });
    }
  }

  /** Provider confirmed: the refund liability is paid out of clearing. */
  async complete(refundId: string, providerRefundId: string | null, tx?: Tx): Promise<void> {
    const run = async (t: Tx) => {
      const refund = await this.lockRefund(t, refundId);
      if (refund.status !== 'REQUESTED') return;
      const now = new Date();
      await t.refund.update({
        where: { id: refund.id },
        data: {
          status: 'SUCCEEDED',
          completedAt: now,
          ...(providerRefundId ? { gatewayRefundId: providerRefundId } : {}),
        },
      });
      await this.ledger.post(t, {
        built: refundCompleted(refund.amountMinor),
        sourceKey: `refund:${refund.id}:completed`,
        refs: { jobId: refund.jobId, paymentId: refund.paymentId, refundId: refund.id },
        description: 'İade ödeme sağlayıcısı tarafından tamamlandı',
      });
      const payment = await t.payment.findUniqueOrThrow({
        where: { id: refund.paymentId },
        include: { job: { select: { customer: { select: { userId: true } }, serviceRequest: { select: { title: true } } } } },
      });
      const totals = await this.refundTotals(t, payment.id);
      await t.payment.update({
        where: { id: payment.id },
        data: {
          status: statusAfterRefunds(payment.amountMinor, totals.succeeded),
          version: { increment: 1 },
        },
      });
      const metadata = { paymentId: payment.id, amountMinor: Number(refund.amountMinor) };
      for (const action of ['payment.refund.completed', 'refund.completed']) {
        await this.audit.recordIn(t, {
          action,
          entityType: 'refund',
          entityId: refund.id,
          metadata,
        });
      }
      await this.notifications.enqueueIn(t, [
        {
          userId: payment.job.customer.userId,
          type: NotificationEvent.REFUND_COMPLETED,
          title: `${formatMoney(Number(refund.amountMinor))} iadeniz tamamlandı.`,
          body: `${payment.job.serviceRequest.title}. İadenin hesabınıza yansıması bankanıza bağlıdır.`,
          data: { jobId: payment.jobId, paymentId: payment.id },
        },
      ]);
    };
    if (tx) await run(tx);
    else await this.prisma.$transaction(run);
  }

  /** Provider refused: the REQUESTED ledger effect is reversed, nothing else. */
  async fail(refundId: string, failureCode: string, providerRefundId?: string, tx?: Tx): Promise<void> {
    const run = async (t: Tx) => {
      const refund = await this.lockRefund(t, refundId);
      if (refund.status !== 'REQUESTED') return;
      await t.refund.update({
        where: { id: refund.id },
        data: {
          status: 'FAILED',
          failureCode,
          completedAt: new Date(),
          ...(providerRefundId ? { gatewayRefundId: providerRefundId } : {}),
        },
      });
      const requested = await t.ledgerTransaction.findUnique({
        where: { sourceKey: `refund:${refund.id}:requested` },
      });
      if (requested) {
        if (requested.earningId) {
          await t.$queryRaw`SELECT id FROM provider_earnings WHERE id = ${requested.earningId}::uuid FOR UPDATE`;
        }
        await this.ledger.reverse(t, requested.id, {
          sourceKey: `refund:${refund.id}:reversed`,
          refs: {
            jobId: requested.jobId,
            paymentId: requested.paymentId,
            refundId: refund.id,
            earningId: requested.earningId,
            providerId: requested.providerId,
          },
          description: 'İade başarısız; iade talebinin muhasebe kaydı geri alındı',
        });
        if (requested.earningId) {
          const job = await t.job.findUniqueOrThrow({
            where: { id: refund.jobId },
            select: { status: true },
          });
          await t.providerEarning.updateMany({
            where: { id: requested.earningId, status: 'REVERSED' },
            data: { status: job.status === 'DISPUTED' ? 'HELD' : 'PENDING', version: { increment: 1 } },
          });
        }
      }
      await this.audit.recordIn(t, {
        action: 'payment.refund.failed',
        entityType: 'refund',
        entityId: refund.id,
        metadata: { paymentId: refund.paymentId, failureCode },
      });
    };
    if (tx) await run(tx);
    else await this.prisma.$transaction(run);
  }

  private async lockRefund(tx: Tx, refundId: string): Promise<Refund> {
    const ref = await tx.refund.findUniqueOrThrow({
      where: { id: refundId },
      select: { paymentId: true, jobId: true },
    });
    // Same order as every finance write: job → payment → refund → earning → accounts.
    await tx.$queryRaw`SELECT id FROM jobs WHERE id = ${ref.jobId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${ref.paymentId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM refunds WHERE id = ${refundId}::uuid FOR UPDATE`;
    return tx.refund.findUniqueOrThrow({ where: { id: refundId } });
  }

  /** Background retry of refunds whose provider call never finished. */
  async retryStale(olderThanSeconds = 60, now = new Date()): Promise<number> {
    const stale = await this.prisma.refund.findMany({
      where: {
        status: 'REQUESTED',
        gatewayRefundId: null,
        createdAt: { lte: new Date(now.getTime() - olderThanSeconds * 1000) },
      },
      select: { id: true },
      take: 50,
    });
    await this.processAll(stale.map((r) => r.id));
    return stale.length;
  }
}
