import { Inject, Injectable } from '@nestjs/common';
import type { AdminCashSettlement, JobPaymentSummary } from '@ustago/types';
import { type AdminCashResolve, type CashDispute, formatMoney } from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import type { CashSettlement, Prisma } from '../generated/prisma/client.js';
import { NotificationEvent } from '../notifications/notification-events.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { canDisputeCash, decideCashConfirm } from './domain/cash.js';
import { feeFor } from './domain/fee.js';
import { cashFeeAssessed } from './domain/ledger.js';
import { FeePolicyService } from './fee-policy.service.js';
import { FINANCE_CONFIG, type FinanceConfig } from './finance.config.js';
import {
  cashDisabled,
  cashInvalidState,
  cashNotAllowed,
  cashNotSelected,
  cashSettlementNotFound,
} from './finance-errors.js';
import { money } from './finance.mappers.js';
import { jobForParty, type JobParties } from './job-access.js';
import { LedgerService } from './ledger.service.js';
import { PaymentsService } from './payments.service.js';

type Tx = Prisma.TransactionClient;

const RATE = { limit: 10, windowSeconds: 60 } as const;

/**
 * "Ustaya doğrudan ödeme" (docs/adr/0020). UstaGO records what both sides
 * say; it never claims to have received or refunded cash. When both sides
 * confirm and cash commission is on, the platform fee becomes the
 * provider's debt in the ledger (no collection happens in Faz 5).
 */
@Injectable()
export class CashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly feePolicy: FeePolicyService,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly rateLimit: RateLimitService,
    @Inject(FINANCE_CONFIG) private readonly config: FinanceConfig,
  ) {}

  async confirm(
    user: AuthUser,
    jobId: string,
    ipAddress: string | null,
  ): Promise<JobPaymentSummary> {
    if (!this.config.cashEnabled) throw cashDisabled();
    await this.rateLimit.enforceWithCode('FINANCE_RATE_LIMITED', {
      bucket: 'cash-confirm',
      subject: user.id,
      ...RATE,
    });
    await this.prisma.$transaction(async (tx) => {
      const p = await this.lockCashJob(tx, jobId, user.id);
      const settlement = await this.lockOrCreate(tx, p);
      const decision = decideCashConfirm(settlement.status, p.party);
      if (decision.kind === 'ALREADY_DONE') return;
      if (decision.kind === 'INVALID') throw cashInvalidState(settlement.status);
      const now = new Date();
      const moved = await tx.cashSettlement.updateMany({
        where: { id: settlement.id, version: settlement.version },
        data: {
          status: decision.to,
          ...(p.party === 'CUSTOMER' ? { customerConfirmedAt: now } : { providerConfirmedAt: now }),
          ...(decision.confirmed ? { confirmedAt: now } : {}),
          version: { increment: 1 },
        },
      });
      if (moved.count === 0) throw cashInvalidState(settlement.status);
      await this.audit.recordIn(tx, {
        action: decision.confirmed ? 'cash.confirmed' : 'cash.party_confirmed',
        actorId: user.id,
        entityType: 'cash_settlement',
        entityId: settlement.id,
        ipAddress,
        metadata: { jobId, party: p.party, amountMinor: Number(settlement.amountMinor) },
      });
      if (decision.confirmed) {
        await this.bookFee(tx, settlement, p, null);
        await this.notifications.enqueueIn(tx, [
          this.note(
            p,
            'CUSTOMER',
            NotificationEvent.CASH_CONFIRMED,
            'Nakit ödeme iki tarafça onaylandı.',
          ),
          this.note(
            p,
            'PROVIDER',
            NotificationEvent.CASH_CONFIRMED,
            'Nakit ödeme iki tarafça onaylandı.',
          ),
        ]);
      } else {
        const other = p.party === 'CUSTOMER' ? 'PROVIDER' : 'CUSTOMER';
        await this.notifications.enqueueIn(tx, [
          this.note(
            p,
            other,
            NotificationEvent.CASH_CONFIRMATION_REQUESTED,
            p.party === 'CUSTOMER'
              ? `Müşteri ${formatMoney(Number(settlement.amountMinor))} nakit ödediğini bildirdi. Lütfen onaylayın.`
              : `Usta ${formatMoney(Number(settlement.amountMinor))} nakit ödemeyi aldığını bildirdi. Lütfen onaylayın.`,
          ),
        ]);
      }
    });
    return this.payments.summary(user.id, jobId);
  }

  async dispute(
    user: AuthUser,
    jobId: string,
    input: CashDispute,
    ipAddress: string | null,
  ): Promise<JobPaymentSummary> {
    if (!this.config.cashEnabled) throw cashDisabled();
    await this.rateLimit.enforceWithCode('FINANCE_RATE_LIMITED', {
      bucket: 'cash-confirm',
      subject: user.id,
      ...RATE,
    });
    await this.prisma.$transaction(async (tx) => {
      const p = await this.lockCashJob(tx, jobId, user.id);
      const settlement = await this.lockOrCreate(tx, p);
      if (settlement.status === 'DISPUTED') return;
      if (!canDisputeCash(settlement.status)) throw cashInvalidState(settlement.status);
      const now = new Date();
      await tx.cashSettlement.update({
        where: { id: settlement.id },
        data: {
          status: 'DISPUTED',
          disputedAt: now,
          disputedById: user.id,
          disputeNote: input.note,
          version: { increment: 1 },
        },
      });
      await this.audit.recordIn(tx, {
        action: 'cash.disputed',
        actorId: user.id,
        entityType: 'cash_settlement',
        entityId: settlement.id,
        ipAddress,
        metadata: { jobId, party: p.party },
      });
      const other = p.party === 'CUSTOMER' ? 'PROVIDER' : 'CUSTOMER';
      await this.notifications.enqueueIn(tx, [
        this.note(
          p,
          other,
          NotificationEvent.CASH_DISPUTED,
          'Nakit ödeme için anlaşmazlık bildirildi. UstaGO ekibi inceleyecek.',
        ),
      ]);
    });
    return this.payments.summary(user.id, jobId);
  }

  /**
   * Admin records the outcome of a cash dispute. UstaGO never touched the
   * cash, so this is a record only: "paid" books the fee like a normal
   * confirmation, "not paid" books nothing. No money is "refunded".
   */
  async adminResolve(
    adminId: string,
    id: string,
    input: AdminCashResolve,
    ipAddress: string | null,
  ): Promise<AdminCashSettlement> {
    await this.prisma.$transaction(async (tx) => {
      const ref = await tx.cashSettlement.findUnique({ where: { id }, select: { jobId: true } });
      if (!ref) throw cashSettlementNotFound();
      await tx.$queryRaw`SELECT id FROM jobs WHERE id = ${ref.jobId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM cash_settlements WHERE id = ${id}::uuid FOR UPDATE`;
      const settlement = await tx.cashSettlement.findUniqueOrThrow({ where: { id } });
      if (settlement.status !== 'DISPUTED') throw cashInvalidState(settlement.status);
      const now = new Date();
      const paid = input.outcome === 'CONFIRM_PAID';
      await tx.cashSettlement.update({
        where: { id },
        data: {
          status: paid ? 'CONFIRMED' : 'RESOLVED_UNPAID',
          confirmedAt: paid ? now : null,
          resolvedById: adminId,
          resolvedAt: now,
          resolutionNote: input.note,
          version: { increment: 1 },
        },
      });
      const job = await tx.job.findUniqueOrThrow({
        where: { id: settlement.jobId },
        include: {
          customer: {
            select: { userId: true, user: { select: { firstName: true, lastName: true } } },
          },
          provider: { select: { userId: true, displayName: true } },
          serviceRequest: { select: { title: true } },
        },
      });
      const parties: JobParties = {
        job,
        party: 'CUSTOMER',
        customerUserId: job.customer.userId,
        providerUserId: job.provider.userId,
        providerName: job.provider.displayName,
        customerName: `${job.customer.user.firstName} ${job.customer.user.lastName}`,
        title: job.serviceRequest.title,
      };
      if (paid) await this.bookFee(tx, settlement, parties, adminId);
      await this.audit.recordIn(tx, {
        action: 'cash.resolved',
        actorId: adminId,
        entityType: 'cash_settlement',
        entityId: id,
        ipAddress,
        metadata: { jobId: settlement.jobId, outcome: input.outcome },
      });
      const text = paid
        ? 'Nakit ödeme anlaşmazlığı sonuçlandı: ödeme yapıldı olarak kaydedildi.'
        : 'Nakit ödeme anlaşmazlığı sonuçlandı: ödeme yapılmadı olarak kaydedildi.';
      await this.notifications.enqueueIn(tx, [
        this.note(parties, 'CUSTOMER', NotificationEvent.CASH_RESOLVED, text),
        this.note(parties, 'PROVIDER', NotificationEvent.CASH_RESOLVED, text),
      ]);
    });
    const row = await this.prisma.cashSettlement.findUniqueOrThrow({
      where: { id },
      include: adminCashInclude,
    });
    return toAdminCash(row);
  }

  private async lockCashJob(tx: Tx, jobId: string, userId: string): Promise<JobParties> {
    const p = await jobForParty(tx, jobId, userId, true);
    if (p.job.paymentMethod !== 'CASH') throw cashNotSelected();
    if (p.job.status !== 'COMPLETED') throw cashNotAllowed(p.job.status);
    return p;
  }

  /** The job's settlement, locked; created on first use with the fee snapshot. */
  private async lockOrCreate(tx: Tx, p: JobParties): Promise<CashSettlement> {
    const existing = await tx.cashSettlement.findUnique({ where: { jobId: p.job.id } });
    if (existing) {
      await tx.$queryRaw`SELECT id FROM cash_settlements WHERE id = ${existing.id}::uuid FOR UPDATE`;
      return tx.cashSettlement.findUniqueOrThrow({ where: { id: existing.id } });
    }
    const policy = await this.feePolicy.forJob(tx, p.job.id, new Date());
    const fee = this.config.cashCommissionEnabled ? feeFor(p.job.currentTotalMinor, policy) : 0n;
    return tx.cashSettlement.create({
      data: {
        jobId: p.job.id,
        providerId: p.job.providerId,
        amountMinor: p.job.currentTotalMinor,
        feeMinor: fee,
        feeBps: policy.bps,
        currency: p.job.currency,
      },
    });
  }

  private async bookFee(
    tx: Tx,
    settlement: CashSettlement,
    p: JobParties,
    adminId: string | null,
  ): Promise<void> {
    if (settlement.feeMinor <= 0n) return;
    await this.ledger.post(tx, {
      built: cashFeeAssessed({ providerId: settlement.providerId, fee: settlement.feeMinor }),
      sourceKey: `cash:${settlement.id}:fee`,
      refs: {
        jobId: settlement.jobId,
        cashSettlementId: settlement.id,
        providerId: settlement.providerId,
      },
      description: 'Nakit iş: platform hizmet bedeli usta borcu olarak kaydedildi',
      createdById: adminId,
    });
    await this.audit.recordIn(tx, {
      action: 'platform_fee.assessed',
      actorId: adminId,
      entityType: 'cash_settlement',
      entityId: settlement.id,
      metadata: {
        jobId: settlement.jobId,
        feeMinor: Number(settlement.feeMinor),
        feeBps: settlement.feeBps,
        method: 'CASH',
      },
    });
    await this.notifications.enqueueIn(tx, [
      this.note(
        p,
        'PROVIDER',
        NotificationEvent.CASH_CONFIRMED,
        `Platform hizmet bedeli ${formatMoney(Number(settlement.feeMinor))} bakiyenize borç olarak işlendi.`,
      ),
    ]);
  }

  private note(p: JobParties, to: 'CUSTOMER' | 'PROVIDER', type: string, title: string) {
    return {
      userId: to === 'CUSTOMER' ? p.customerUserId : p.providerUserId,
      type,
      title,
      body: p.title,
      data: { jobId: p.job.id },
    };
  }
}

export const adminCashInclude = {
  job: {
    select: {
      serviceRequest: { select: { title: true } },
      customer: { select: { user: { select: { firstName: true, lastName: true } } } },
    },
  },
  provider: { select: { displayName: true } },
} satisfies Prisma.CashSettlementInclude;

export function toAdminCash(
  c: Prisma.CashSettlementGetPayload<{ include: typeof adminCashInclude }>,
): AdminCashSettlement {
  const u = c.job.customer.user;
  return {
    id: c.id,
    jobId: c.jobId,
    jobTitle: c.job.serviceRequest.title,
    providerName: c.provider.displayName,
    customerName: `${u.firstName} ${u.lastName.slice(0, 1)}.`,
    amount: money(c.amountMinor, c.currency),
    fee: money(c.feeMinor, c.currency),
    status: c.status,
    customerConfirmedAt: c.customerConfirmedAt?.toISOString() ?? null,
    providerConfirmedAt: c.providerConfirmedAt?.toISOString() ?? null,
    disputedAt: c.disputedAt?.toISOString() ?? null,
    disputeNote: c.disputeNote,
    resolutionNote: c.resolutionNote,
    createdAt: c.createdAt.toISOString(),
  };
}
