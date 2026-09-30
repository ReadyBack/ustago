import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  JobPaymentSummary,
  MyPaymentDetail,
  MyPaymentListItem,
  Paginated,
  Payment,
  PaymentMethodChoice,
} from '@ustago/types';
import { formatMoney, type ListMyPaymentsQuery } from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { Prisma } from '../generated/prisma/client.js';
import type { Payment as PaymentRow, PaymentTransaction } from '../generated/prisma/client.js';
import { NotificationEvent } from '../notifications/notification-events.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { canDisputeCash, hasConfirmed } from './domain/cash.js';
import { initialEarningStatus, holdUntil } from './domain/earning.js';
import { feeFor, incrementalFee, splitGross } from './domain/fee.js';
import { paymentCaptured } from './domain/ledger.js';
import {
  CAPTURED_PAYMENT_STATUSES,
  decideAttemptTransition,
  IN_FLIGHT_PAYMENT_STATUSES,
  isCaptured,
  isInFlight,
  outstandingAmount,
  PAYABLE_JOB_STATUSES,
  type ProviderAttemptState,
} from './domain/payment-state.js';
import { EarningsService } from './earnings.service.js';
import { FeePolicyService } from './fee-policy.service.js';
import { FINANCE_CONFIG, type FinanceConfig } from './finance.config.js';
import {
  cashDisabled,
  idempotencyKeyReused,
  methodIsCash,
  methodLocked,
  nothingDue,
  paymentNotAllowed,
  paymentNotFound,
  paymentsDisabled,
  paymentWrongParty,
} from './finance-errors.js';
import { money, toAttempt, toPayment } from './finance.mappers.js';
import { jobForParty } from './job-access.js';
import { LedgerService } from './ledger.service.js';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  PaymentProviderError,
} from './providers/payment-provider.js';
import { redact } from './redact.js';
import { RefundsService } from './refunds.service.js';

type Tx = Prisma.TransactionClient;
type PaymentWithAttempts = PaymentRow & { transactions: PaymentTransaction[] };

/** Money-moving endpoints get their own, tighter limits (per user). */
const RATE = { payment: { limit: 10, windowSeconds: 60 } } as const;

export interface AttemptOutcomeResult {
  outcome: 'PROCESSED' | 'IGNORED_STALE';
  /** Refunds to send to the provider after commit (late / duplicate money). */
  refundIds: string[];
}

/**
 * Online payments and the job's payment summary (docs/adr/0019).
 *
 * - The amount is always computed here: job total − captured − in flight.
 * - Money is confirmed only by the payment provider (verified webhook or a
 *   server-to-server answer), never by the client.
 * - One payment in flight per job (partial unique index + job row lock),
 *   so concurrent taps / devices can never overpay.
 * - A change order accepted after a payment leaves a remainder that the
 *   customer pays as a separate, explicit payment ("₺500 ÖDE"); nothing is
 *   charged silently.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly feePolicy: FeePolicyService,
    private readonly earnings: EarningsService,
    private readonly refunds: RefundsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
    @Inject(FINANCE_CONFIG) private readonly config: FinanceConfig,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  private get onlineEnabled(): boolean {
    return this.config.paymentsEnabled && this.config.paymentProvider !== 'disabled';
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------

  async summary(userId: string, jobId: string): Promise<JobPaymentSummary> {
    return this.prisma.$transaction(async (tx) => {
      const p = await jobForParty(tx, jobId, userId, false);
      const { job } = p;
      const payments = await tx.payment.findMany({
        where: { jobId },
        include: { transactions: true },
        orderBy: { createdAt: 'asc' },
      });
      const refundRows = await tx.refund.groupBy({
        by: ['paymentId'],
        where: { jobId, status: 'SUCCEEDED' },
        _sum: { amountMinor: true },
      });
      const refundedOf = (id: string) =>
        refundRows.find((r) => r.paymentId === id)?._sum.amountMinor ?? 0n;
      const captured = payments.filter((x) => isCaptured(x.status));
      const inFlight = payments.find((x) => isInFlight(x.status)) ?? null;
      const paid = captured.reduce((a, x) => a + x.amountMinor, 0n);
      const refunded = captured.reduce((a, x) => a + refundedOf(x.id), 0n);
      const outstanding = outstandingAmount({
        jobTotal: job.currentTotalMinor,
        captured: paid,
        inFlight: 0n,
      });
      const cash = await tx.cashSettlement.findUnique({ where: { jobId } });
      const view = (x: PaymentWithAttempts): Payment =>
        toPayment(x, refundedOf(x.id), this.provider.isTestMode && x.gateway === 'mock');

      const isCustomer = p.party === 'CUSTOMER';
      const open = job.status !== 'CANCELLED';
      const method = (
        job.paymentMethod === 'BANK_TRANSFER' ? null : job.paymentMethod
      ) as PaymentMethodChoice | null;
      const cashParty = p.party;
      let breakdown: JobPaymentSummary['providerBreakdown'] = null;
      if (p.party === 'PROVIDER') {
        const policy = await this.feePolicy.peekForJob(tx, jobId, new Date());
        if (policy) {
          const fee = feeFor(job.currentTotalMinor, policy);
          const split = splitGross(job.currentTotalMinor, fee);
          breakdown = {
            gross: money(split.gross),
            platformFee: money(split.fee),
            net: money(split.net),
            feeBps: policy.bps,
            developmentPolicy: policy.isDevelopment,
          };
        }
      }
      return {
        jobId,
        viewerRole: p.party,
        method,
        total: money(job.currentTotalMinor, job.currency),
        paid: money(paid, job.currency),
        refunded: money(refunded, job.currency),
        netPaid: money(paid - refunded, job.currency),
        outstanding: money(outstanding, job.currency),
        inFlight: inFlight ? view(inFlight) : null,
        payments: payments
          .filter((x) => x.status !== 'CANCELLED' || x.transactions.length > 0)
          .map(view),
        cash: cash
          ? {
              id: cash.id,
              status: cash.status,
              amount: money(cash.amountMinor, cash.currency),
              customerConfirmedAt: cash.customerConfirmedAt?.toISOString() ?? null,
              providerConfirmedAt: cash.providerConfirmedAt?.toISOString() ?? null,
              confirmedAt: cash.confirmedAt?.toISOString() ?? null,
              disputedAt: cash.disputedAt?.toISOString() ?? null,
            }
          : null,
        testMode: this.provider.isTestMode,
        onlineEnabled: this.onlineEnabled,
        cashEnabled: this.config.cashEnabled,
        actions: {
          canChooseMethod:
            isCustomer && open && job.status !== 'DISPUTED' && captured.length === 0 && !cash,
          canPayOnline:
            isCustomer &&
            this.onlineEnabled &&
            method !== 'CASH' &&
            PAYABLE_JOB_STATUSES.includes(job.status) &&
            outstanding > 0n,
          canConfirmCash:
            this.config.cashEnabled &&
            method === 'CASH' &&
            job.status === 'COMPLETED' &&
            (cash === null ||
              (cash.status !== 'DISPUTED' &&
                cash.status !== 'RESOLVED_UNPAID' &&
                !hasConfirmed(cash.status, cashParty))),
          canDisputeCash:
            this.config.cashEnabled &&
            method === 'CASH' &&
            job.status === 'COMPLETED' &&
            (cash === null || canDisputeCash(cash.status)),
        },
        providerBreakdown: breakdown,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Payment method
  // -------------------------------------------------------------------------

  async chooseMethod(
    user: AuthUser,
    jobId: string,
    method: PaymentMethodChoice,
    ipAddress: string | null,
  ): Promise<JobPaymentSummary> {
    if (method === 'CASH' && !this.config.cashEnabled) throw cashDisabled();
    if (method === 'IN_APP' && !this.onlineEnabled) throw paymentsDisabled();
    const cancelled: PaymentWithAttempts[] = [];
    await this.prisma.$transaction(async (tx) => {
      const p = await jobForParty(tx, jobId, user.id, true);
      if (p.party !== 'CUSTOMER') throw paymentWrongParty();
      const { job } = p;
      if (job.status === 'CANCELLED' || job.status === 'DISPUTED') {
        throw methodLocked(`job_${job.status.toLowerCase()}`);
      }
      if (job.paymentMethod === method) return;
      const captured = await tx.payment.count({
        where: { jobId, status: { in: [...CAPTURED_PAYMENT_STATUSES] } },
      });
      if (captured > 0) throw methodLocked('payment_made');
      const cash = await tx.cashSettlement.count({ where: { jobId } });
      if (cash > 0) throw methodLocked('cash_settlement_started');
      if (method === 'CASH') {
        // An unfinished online payment is withdrawn.
        cancelled.push(...(await this.cancelInFlight(tx, jobId, new Date())));
      }
      await tx.job.update({ where: { id: jobId }, data: { paymentMethod: method } });
      await this.audit.recordIn(tx, {
        action: 'job.payment_method_selected',
        actorId: user.id,
        entityType: 'job',
        entityId: jobId,
        ipAddress,
        metadata: { method, previous: job.paymentMethod ?? null },
      });
    });
    await this.cancelAtProvider(cancelled);
    return this.summary(user.id, jobId);
  }

  /** Cancels in-flight payments of a job (caller holds the job lock). */
  async cancelInFlight(tx: Tx, jobId: string, now: Date): Promise<PaymentWithAttempts[]> {
    const rows = await tx.payment.findMany({
      where: { jobId, status: { in: [...IN_FLIGHT_PAYMENT_STATUSES] } },
      include: { transactions: true },
    });
    for (const row of rows) {
      await tx.payment.update({
        where: { id: row.id },
        data: { status: 'CANCELLED', cancelledAt: now, version: { increment: 1 } },
      });
      await tx.paymentTransaction.updateMany({
        where: { paymentId: row.id, status: 'PENDING' },
        data: { status: 'CANCELLED', completedAt: now },
      });
      await this.audit.recordIn(tx, {
        action: 'payment.cancelled',
        entityType: 'payment',
        entityId: row.id,
        metadata: { jobId },
      });
    }
    return rows;
  }

  async cancelAtProvider(payments: readonly PaymentWithAttempts[]): Promise<void> {
    for (const p of payments) {
      for (const a of p.transactions) {
        if (!a.gatewayTransactionId) continue;
        try {
          await this.provider.cancelPayment(a.gatewayTransactionId);
        } catch (error) {
          this.logger.warn(
            `Could not cancel attempt ${a.id} at the provider: ${JSON.stringify(redact(String(error)))}`,
          );
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Create / retry
  // -------------------------------------------------------------------------

  /**
   * "Uygulamadan Öde". Idempotent on the Idempotency-Key. Starts a new
   * attempt on the job's in-flight payment when its amount is still right
   * (retry after a declined card), otherwise a new payment for the
   * outstanding amount.
   */
  async create(
    user: AuthUser,
    jobId: string,
    idempotencyKey: string,
    ipAddress: string | null,
  ): Promise<Payment> {
    if (!this.onlineEnabled) throw paymentsDisabled();
    const replay = await this.replayed(user.id, jobId, idempotencyKey);
    if (replay) return replay;
    await this.rateLimit.enforceWithCode('FINANCE_RATE_LIMITED', {
      bucket: 'payment-create',
      subject: user.id,
      ...RATE.payment,
    });

    let started: { paymentId: string; attempt: PaymentTransaction } | null = null;
    const staleCancelled: PaymentWithAttempts[] = [];
    try {
      started = await this.prisma.$transaction(async (tx) => {
        const p = await jobForParty(tx, jobId, user.id, true);
        if (p.party !== 'CUSTOMER') throw paymentWrongParty();
        const { job } = p;
        if (!PAYABLE_JOB_STATUSES.includes(job.status)) throw paymentNotAllowed(job.status);
        if (job.paymentMethod === 'CASH') throw methodIsCash();
        const again = await tx.paymentTransaction.findUnique({ where: { idempotencyKey } });
        if (again) return null;
        const now = new Date();
        // Makes sure a fee policy exists before any money is asked for.
        await this.feePolicy.forJob(tx, jobId, now);
        if (!job.paymentMethod) {
          await tx.job.update({ where: { id: jobId }, data: { paymentMethod: 'IN_APP' } });
        }

        const payments = await tx.payment.findMany({
          where: { jobId },
          include: { transactions: true },
        });
        const captured = payments
          .filter((x) => isCaptured(x.status))
          .reduce((a, x) => a + x.amountMinor, 0n);
        const due = outstandingAmount({ jobTotal: job.currentTotalMinor, captured, inFlight: 0n });
        const inFlight = payments.find((x) => isInFlight(x.status));

        if (inFlight) {
          const last = [...inFlight.transactions].sort(
            (a, b) => b.attemptNumber - a.attemptNumber,
          )[0];
          if (inFlight.amountMinor === due) {
            if (last && last.status === 'PENDING') return { paymentId: inFlight.id, attempt: last };
            if (inFlight.transactions.length < this.config.maxPaymentAttempts) {
              const attempt = await this.newAttempt(
                tx,
                inFlight,
                (last?.attemptNumber ?? 0) + 1,
                idempotencyKey,
              );
              return { paymentId: inFlight.id, attempt };
            }
            await tx.payment.update({
              where: { id: inFlight.id },
              data: { status: 'FAILED', failedAt: now, version: { increment: 1 } },
            });
            await this.audit.recordIn(tx, {
              action: 'payment.failed',
              entityType: 'payment',
              entityId: inFlight.id,
              metadata: { jobId, reason: 'max_attempts' },
            });
          } else {
            // A change order was accepted meanwhile: the old amount is stale.
            staleCancelled.push(...(await this.cancelInFlight(tx, jobId, now)));
          }
        }
        if (due <= 0n) throw nothingDue();

        const payment = await tx.payment.create({
          data: {
            jobId,
            payerId: user.id,
            providerId: job.providerId,
            method: 'IN_APP',
            amountMinor: due,
            currency: job.currency,
            gateway: this.provider.name,
            idempotencyKey,
          },
        });
        const attempt = await this.newAttempt(tx, payment, 1, idempotencyKey);
        await this.audit.recordIn(tx, {
          action: 'payment.created',
          actorId: user.id,
          entityType: 'payment',
          entityId: payment.id,
          ipAddress,
          metadata: {
            jobId,
            amountMinor: Number(due),
            jobTotalMinor: Number(job.currentTotalMinor),
            capturedBeforeMinor: Number(captured),
            gateway: this.provider.name,
          },
        });
        return { paymentId: payment.id, attempt };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Two different keys raced for the job's single in-flight slot, or
        // the same key twice: the winner's payment is the answer.
        const again = await this.replayed(user.id, jobId, idempotencyKey);
        if (again) return again;
        const current = await this.prisma.payment.findFirst({
          where: { jobId, status: { in: [...IN_FLIGHT_PAYMENT_STATUSES] } },
        });
        if (current) return this.paymentView(current.id);
      }
      throw error;
    }
    await this.cancelAtProvider(staleCancelled);
    if (!started) {
      const again = await this.replayed(user.id, jobId, idempotencyKey);
      if (again) return again;
      throw idempotencyKeyReused();
    }
    if (!started.attempt.gatewayTransactionId) {
      await this.startAtProvider(started.paymentId, started.attempt);
    }
    return this.paymentView(started.paymentId);
  }

  private async newAttempt(
    tx: Tx,
    payment: PaymentRow,
    attemptNumber: number,
    idempotencyKey: string,
  ): Promise<PaymentTransaction> {
    return tx.paymentTransaction.create({
      data: {
        paymentId: payment.id,
        type: 'CAPTURE',
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        gateway: this.provider.name,
        idempotencyKey,
        attemptNumber,
      },
    });
  }

  /** Calls the provider outside the DB transaction and stores its id. */
  private async startAtProvider(paymentId: string, attempt: PaymentTransaction): Promise<void> {
    try {
      const result = await this.provider.createPayment({
        paymentId,
        attemptId: attempt.id,
        amountMinor: attempt.amountMinor,
        currency: 'TRY',
        idempotencyKey: attempt.id,
        description: 'UstaGO hizmet bedeli',
      });
      await this.prisma.paymentTransaction.updateMany({
        where: { id: attempt.id, gatewayTransactionId: null },
        data: { gatewayTransactionId: result.providerPaymentId },
      });
      if (result.state !== 'PENDING') {
        // A synchronous server-to-server answer is provider truth too.
        const refundIds = await this.prisma.$transaction((tx) =>
          this.applyAttemptOutcome(tx, attempt.id, result.state, result.failureCode ?? null).then(
            (r) => r.refundIds,
          ),
        );
        await this.refunds.processAll(refundIds);
      }
    } catch (error) {
      const code = error instanceof PaymentProviderError ? error.code : 'PROVIDER_ERROR';
      this.logger.warn(`Payment attempt ${attempt.id} failed at the provider: ${code}`);
      await this.prisma.$transaction((tx) =>
        this.applyAttemptOutcome(tx, attempt.id, 'FAILED', code),
      );
    }
  }

  private async replayed(
    userId: string,
    jobId: string,
    idempotencyKey: string,
  ): Promise<Payment | null> {
    const attempt = await this.prisma.paymentTransaction.findUnique({
      where: { idempotencyKey },
      include: { payment: { select: { id: true, payerId: true, jobId: true } } },
    });
    if (!attempt) return null;
    if (attempt.payment.payerId !== userId || attempt.payment.jobId !== jobId) {
      throw idempotencyKeyReused();
    }
    return this.paymentView(attempt.payment.id);
  }

  async paymentView(paymentId: string): Promise<Payment> {
    const p = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { transactions: true },
    });
    if (!p) throw paymentNotFound();
    const totals = await this.refunds.refundTotals(this.prisma, p.id);
    return toPayment(p, totals.succeeded, this.provider.isTestMode && p.gateway === 'mock');
  }

  // -------------------------------------------------------------------------
  // Provider outcome (webhook / server-to-server)
  // -------------------------------------------------------------------------

  /**
   * Applies what the provider reported for one attempt. Locks job →
   * payment → attempt. Forward-only: a late "pending" after "succeeded" is
   * ignored as stale. Returns refunds to process after commit when money
   * arrived for a payment that is no longer wanted (cancelled job,
   * overpayment after a stale attempt succeeded).
   */
  async applyAttemptOutcome(
    tx: Tx,
    attemptId: string,
    reported: ProviderAttemptState,
    failureCode: string | null,
  ): Promise<AttemptOutcomeResult> {
    const ref = await tx.paymentTransaction.findUniqueOrThrow({
      where: { id: attemptId },
      select: { payment: { select: { id: true, jobId: true } } },
    });
    await tx.$queryRaw`SELECT id FROM jobs WHERE id = ${ref.payment.jobId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${ref.payment.id}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM payment_transactions WHERE id = ${attemptId}::uuid FOR UPDATE`;
    const attempt = await tx.paymentTransaction.findUniqueOrThrow({ where: { id: attemptId } });
    const decision = decideAttemptTransition(attempt.status, reported);
    if (decision.kind === 'STALE') return { outcome: 'IGNORED_STALE', refundIds: [] };
    if (decision.kind === 'NOOP') return { outcome: 'PROCESSED', refundIds: [] };

    const now = new Date();
    await tx.paymentTransaction.update({
      where: { id: attempt.id },
      data: {
        status: decision.to,
        completedAt: decision.to === 'PENDING' ? null : now,
        failureCode: decision.to === 'FAILED' ? (failureCode ?? 'PROVIDER_ERROR') : null,
      },
    });
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: attempt.paymentId } });

    if (decision.to === 'FAILED') {
      await tx.payment.update({
        where: { id: payment.id },
        data: { lastFailureCode: failureCode ?? 'PROVIDER_ERROR', version: { increment: 1 } },
      });
      await this.audit.recordIn(tx, {
        action: 'payment.failed',
        entityType: 'payment',
        entityId: payment.id,
        metadata: {
          jobId: payment.jobId,
          attemptId: attempt.id,
          attemptNumber: attempt.attemptNumber,
          failureCode: failureCode ?? 'PROVIDER_ERROR',
        },
      });
      return { outcome: 'PROCESSED', refundIds: [] };
    }
    if (decision.to !== 'SUCCEEDED') return { outcome: 'PROCESSED', refundIds: [] };
    return { outcome: 'PROCESSED', refundIds: await this.capture(tx, payment, attempt, now) };
  }

  private async capture(
    tx: Tx,
    payment: PaymentRow,
    attempt: PaymentTransaction,
    now: Date,
  ): Promise<string[]> {
    if (isCaptured(payment.status)) return [];
    const job = await tx.job.findUniqueOrThrow({
      where: { id: payment.jobId },
      include: {
        customer: { select: { userId: true } },
        provider: { select: { userId: true } },
        serviceRequest: { select: { title: true } },
      },
    });
    const policy = await this.feePolicy.forJob(tx, job.id, now);
    const capturedBefore =
      (
        await tx.payment.aggregate({
          where: { jobId: job.id, status: { in: [...CAPTURED_PAYMENT_STATUSES] } },
          _sum: { amountMinor: true },
        })
      )._sum.amountMinor ?? 0n;
    const fee = incrementalFee(capturedBefore, payment.amountMinor, policy);
    const split = splitGross(payment.amountMinor, fee);
    const lateMoney = payment.status === 'CANCELLED' || payment.status === 'FAILED';

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'SUCCEEDED',
        succeededAt: now,
        platformFeeMinor: fee,
        platformFeeBps: policy.bps,
        gatewayReference: attempt.gatewayTransactionId,
        lastFailureCode: null,
        version: { increment: 1 },
      },
    });
    const earning = await tx.providerEarning.create({
      data: {
        providerId: job.providerId,
        jobId: job.id,
        paymentId: payment.id,
        grossMinor: split.gross,
        feeMinor: split.fee,
        netMinor: split.net,
        feeBps: policy.bps,
        currency: payment.currency,
        status: initialEarningStatus(job.status),
        heldAt: job.status === 'DISPUTED' ? now : null,
        holdUntil:
          job.status === 'COMPLETED' && job.completedAt
            ? holdUntil(job.completedAt, now, this.config.earningHoldHours)
            : null,
      },
    });
    await this.ledger.post(tx, {
      built: paymentCaptured({ providerId: job.providerId, gross: split.gross, fee: split.fee }),
      sourceKey: `payment:${payment.id}:captured`,
      refs: {
        jobId: job.id,
        paymentId: payment.id,
        earningId: earning.id,
        providerId: job.providerId,
      },
      description: `Online ödeme alındı (${this.provider.isTestMode ? 'TEST' : payment.gateway})`,
    });
    const base = { jobId: job.id, paymentId: payment.id };
    await this.audit.recordIn(tx, {
      action: 'payment.succeeded',
      entityType: 'payment',
      entityId: payment.id,
      metadata: { ...base, amountMinor: Number(split.gross), attemptId: attempt.id, lateMoney },
    });
    await this.audit.recordIn(tx, {
      action: 'platform_fee.assessed',
      entityType: 'payment',
      entityId: payment.id,
      metadata: {
        ...base,
        feeMinor: Number(split.fee),
        feeBps: policy.bps,
        policyId: policy.policyId,
      },
    });
    await this.audit.recordIn(tx, {
      action: 'provider_earning.created',
      entityType: 'provider_earning',
      entityId: earning.id,
      metadata: { ...base, netMinor: Number(split.net), status: earning.status },
    });
    await this.notifications.enqueueIn(tx, [
      {
        userId: job.customer.userId,
        type: NotificationEvent.PAYMENT_SUCCEEDED,
        title: `${formatMoney(Number(split.gross))} ödemeniz alındı.`,
        body: job.serviceRequest.title,
        data: base,
      },
      {
        userId: job.provider.userId,
        type: NotificationEvent.PAYMENT_RECEIVED,
        title: `Müşteri ${formatMoney(Number(split.gross))} ödedi (uygulama içi).`,
        body: `${job.serviceRequest.title} · Net kazanç ${formatMoney(Number(split.net))}`,
        data: { jobId: job.id },
      },
    ]);
    if (job.status === 'COMPLETED') await this.earnings.releaseIfDue(tx, earning.id, now);

    // Money that is not wanted any more goes straight back.
    const refundIds: string[] = [];
    if (job.status === 'CANCELLED') {
      const r = await this.refunds.requestInTx(tx, {
        paymentId: payment.id,
        amount: payment.amountMinor,
        reason: 'JOB_CANCELLED',
        note: 'İş iptal edildikten sonra gelen ödeme otomatik iade edildi.',
        requestedById: null,
        idempotencyKey: `system:late-cancelled:${payment.id}`,
        now,
      });
      refundIds.push(r.id);
    } else {
      const over = capturedBefore + payment.amountMinor - job.currentTotalMinor;
      if (over > 0n) {
        const r = await this.refunds.requestInTx(tx, {
          paymentId: payment.id,
          amount: over,
          reason: 'DUPLICATE_PAYMENT',
          note: 'İş toplamını aşan ödeme otomatik iade edildi.',
          requestedById: null,
          idempotencyKey: `system:overpayment:${payment.id}`,
          now,
        });
        refundIds.push(r.id);
      }
    }
    return refundIds;
  }

  // -------------------------------------------------------------------------
  // "Ödemelerim"
  // -------------------------------------------------------------------------

  async myPayments(
    userId: string,
    query: ListMyPaymentsQuery,
  ): Promise<Paginated<MyPaymentListItem>> {
    const take = query.limit + 1;
    const cursor = query.cursor ? { id: { lt: query.cursor } } : {};
    const [online, cash] = await Promise.all([
      this.prisma.payment.findMany({
        where: {
          payerId: userId,
          status: { notIn: ['CANCELLED'] },
          ...cursor,
        },
        include: { job: { select: { serviceRequest: { select: { title: true } } } } },
        orderBy: { id: 'desc' },
        take,
      }),
      this.prisma.cashSettlement.findMany({
        where: { job: { customer: { userId } }, ...cursor },
        include: { job: { select: { serviceRequest: { select: { title: true } } } } },
        orderBy: { id: 'desc' },
        take,
      }),
    ]);
    const refunded = await this.prisma.refund.groupBy({
      by: ['paymentId'],
      where: { paymentId: { in: online.map((p) => p.id) }, status: 'SUCCEEDED' },
      _sum: { amountMinor: true },
    });
    const items: MyPaymentListItem[] = [
      ...online.map((p) => ({
        kind: 'ONLINE' as const,
        id: p.id,
        jobId: p.jobId,
        title: p.job.serviceRequest.title,
        amount: money(p.amountMinor, p.currency),
        refunded: money(
          refunded.find((r) => r.paymentId === p.id)?._sum.amountMinor ?? 0n,
          p.currency,
        ),
        method: 'IN_APP' as const,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
      })),
      ...cash.map((c) => ({
        kind: 'CASH' as const,
        id: c.id,
        jobId: c.jobId,
        title: c.job.serviceRequest.title,
        amount: money(c.amountMinor, c.currency),
        refunded: money(0n, c.currency),
        method: 'CASH' as const,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
      })),
    ].sort((a, b) => (a.id < b.id ? 1 : -1));
    const page = items.slice(0, query.limit);
    return {
      items: page,
      nextCursor: items.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /** Ödeme Özeti for one of the customer's payments (online or cash). */
  async myPayment(userId: string, id: string): Promise<MyPaymentDetail> {
    const include = {
      job: {
        select: {
          currentTotalMinor: true,
          completedAt: true,
          customer: { select: { userId: true } },
          provider: { select: { displayName: true } },
          serviceRequest: { select: { title: true } },
        },
      },
    } as const;
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: { ...include, transactions: true },
    });
    if (payment && payment.job.customer.userId === userId) {
      const totals = await this.refunds.refundTotals(this.prisma, payment.id);
      return {
        kind: 'ONLINE',
        id: payment.id,
        jobId: payment.jobId,
        title: payment.job.serviceRequest.title,
        amount: money(payment.amountMinor, payment.currency),
        refunded: money(totals.succeeded, payment.currency),
        method: 'IN_APP',
        status: payment.status,
        createdAt: payment.createdAt.toISOString(),
        providerName: payment.job.provider.displayName,
        jobTotal: money(payment.job.currentTotalMinor, payment.currency),
        net: money(payment.amountMinor - totals.succeeded, payment.currency),
        completedAt: payment.succeededAt?.toISOString() ?? null,
        testMode: this.provider.isTestMode && payment.gateway === 'mock',
        attempts: payment.transactions
          .sort((a, b) => a.attemptNumber - b.attemptNumber)
          .map(toAttempt),
      };
    }
    const cash = await this.prisma.cashSettlement.findUnique({ where: { id }, include });
    if (cash && cash.job.customer.userId === userId) {
      return {
        kind: 'CASH',
        id: cash.id,
        jobId: cash.jobId,
        title: cash.job.serviceRequest.title,
        amount: money(cash.amountMinor, cash.currency),
        refunded: money(0n, cash.currency),
        method: 'CASH',
        status: cash.status,
        createdAt: cash.createdAt.toISOString(),
        providerName: cash.job.provider.displayName,
        jobTotal: money(cash.job.currentTotalMinor, cash.currency),
        net: money(cash.amountMinor, cash.currency),
        completedAt: cash.confirmedAt?.toISOString() ?? null,
        testMode: false,
        attempts: [],
      };
    }
    throw paymentNotFound();
  }

  /** For the dev-only test screen: the payer's in-flight attempt to decide. */
  async pendingAttemptForPayer(
    userId: string,
    paymentId: string,
  ): Promise<{ payment: PaymentRow; attempt: PaymentTransaction }> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { transactions: true },
    });
    if (!payment || payment.payerId !== userId) throw paymentNotFound();
    const attempt = payment.transactions
      .filter((a) => a.status === 'PENDING' && a.gatewayTransactionId)
      .sort((a, b) => b.attemptNumber - a.attemptNumber)[0];
    if (!isInFlight(payment.status) || !attempt) throw paymentNotAllowed(payment.status);
    const { transactions: _ignored, ...row } = payment;
    return { payment: row, attempt };
  }
}
