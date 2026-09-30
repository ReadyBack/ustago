import { Inject, Injectable } from '@nestjs/common';
import type {
  AdminCashSettlement,
  AdminFinanceSummary,
  AdminPaymentDetail,
  AdminPaymentListItem,
  AdminPayout,
  AdminRefund,
  LedgerTransactionView,
  Paginated,
} from '@ustago/types';
import type {
  AdminRefundRequest,
  FinanceSummaryQuery,
  ListAdminCashQuery,
  ListAdminLedgerQuery,
  ListAdminPaymentsQuery,
  ListAdminPayoutsQuery,
} from '@ustago/validation';

import { notFound } from '../common/http/errors.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { adminCashInclude, toAdminCash } from './cash.service.js';
import { CAPTURED_PAYMENT_STATUSES } from './domain/payment-state.js';
import { refundableAmount } from './domain/refund.js';
import { idempotencyKeyReused, paymentNotFound, refundStale } from './finance-errors.js';
import { FINANCE_CONFIG, type FinanceConfig } from './finance.config.js';
import { money, toAttempt } from './finance.mappers.js';
import { toAdminPayout } from './payouts.service.js';
import { RefundsService } from './refunds.service.js';
import { earningInclude, toEarning } from './wallet.service.js';

const DAY_MS = 86_400_000;
const ISTANBUL_OFFSET_MS = 3 * 3_600_000;

const paymentListInclude = {
  job: {
    select: {
      serviceRequest: { select: { title: true } },
      customer: { select: { user: { select: { firstName: true, lastName: true } } } },
      provider: { select: { displayName: true } },
    },
  },
} satisfies Prisma.PaymentInclude;

const ledgerInclude = {
  entries: {
    include: { account: { include: { provider: { select: { displayName: true } } } } },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.LedgerTransactionInclude;

type LedgerRow = Prisma.LedgerTransactionGetPayload<{ include: typeof ledgerInclude }>;
type PaymentListRow = Prisma.PaymentGetPayload<{ include: typeof paymentListInclude }>;

/** Start of "today" in Europe/Istanbul (UTC+3, no DST). */
export function rangeStart(range: FinanceSummaryQuery['range'], now: Date): Date {
  if (range === '7d') return new Date(now.getTime() - 7 * DAY_MS);
  if (range === '30d') return new Date(now.getTime() - 30 * DAY_MS);
  const local = new Date(now.getTime() + ISTANBUL_OFFSET_MS);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - ISTANBUL_OFFSET_MS,
  );
}

const shortName = (u: { firstName: string; lastName: string }) =>
  `${u.firstName} ${u.lastName.slice(0, 1)}.`;

export function toLedgerView(t: LedgerRow): LedgerTransactionView {
  let debit = 0n;
  let credit = 0n;
  for (const e of t.entries) {
    if (e.direction === 'DEBIT') debit += e.amountMinor;
    else credit += e.amountMinor;
  }
  return {
    id: t.id,
    type: t.type,
    sourceKey: t.sourceKey,
    description: t.description,
    createdAt: t.createdAt.toISOString(),
    jobId: t.jobId,
    paymentId: t.paymentId,
    refundId: t.refundId,
    payoutId: t.payoutId,
    cashSettlementId: t.cashSettlementId,
    earningId: t.earningId,
    reversesId: t.reversesId,
    entries: t.entries.map((e) => ({
      accountType: e.account.type,
      owner: e.account.provider?.displayName ?? 'Platform',
      direction: e.direction,
      amount: money(e.amountMinor, e.currency),
    })),
    totalDebit: money(debit, t.currency),
    totalCredit: money(credit, t.currency),
    imbalance: money(debit - credit, t.currency),
  };
}

/**
 * Admin finance screens (Faz 5): dashboard aggregates straight from the
 * database, payment / ledger / payout / cash lists and the one money
 * decision an admin takes here, a (full or partial) refund. Refund
 * amounts are always recomputed on the server; the admin's figure is only
 * a guard against a stale confirm screen.
 */
@Injectable()
export class AdminFinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refunds: RefundsService,
    @Inject(FINANCE_CONFIG) private readonly config: FinanceConfig,
  ) {}

  async summary(query: FinanceSummaryQuery, now = new Date()): Promise<AdminFinanceSummary> {
    const from = rangeStart(query.range, now);
    const [online, cash, fees, balances, pendingRefunds, pendingPayouts, openCashDisputes] =
      await Promise.all([
        this.prisma.payment.aggregate({
          where: {
            status: { in: [...CAPTURED_PAYMENT_STATUSES] },
            succeededAt: { gte: from, lte: now },
          },
          _sum: { amountMinor: true },
          _count: true,
        }),
        this.prisma.cashSettlement.aggregate({
          where: { status: 'CONFIRMED', confirmedAt: { gte: from, lte: now } },
          _sum: { amountMinor: true },
          _count: true,
        }),
        this.prisma.$queryRaw<{ net: bigint }[]>`
          SELECT COALESCE(SUM(CASE WHEN e.direction = 'CREDIT' THEN e.amount_minor ELSE -e.amount_minor END), 0)::bigint AS net
          FROM ledger_entries e
          JOIN ledger_accounts a ON a.id = e.account_id
          WHERE a.type = 'PLATFORM_FEE_REVENUE' AND e.created_at >= ${from} AND e.created_at <= ${now}`,
        this.prisma.$queryRaw<{ payable: bigint; debt: bigint }[]>`
          SELECT
            COALESCE(SUM(CASE WHEN a.type IN ('PROVIDER_PENDING', 'PROVIDER_AVAILABLE', 'PROVIDER_RESERVED')
              THEN (CASE WHEN e.direction = 'CREDIT' THEN e.amount_minor ELSE -e.amount_minor END) ELSE 0 END), 0)::bigint AS payable,
            COALESCE(SUM(CASE WHEN a.type = 'PROVIDER_PLATFORM_DEBT'
              THEN (CASE WHEN e.direction = 'DEBIT' THEN e.amount_minor ELSE -e.amount_minor END) ELSE 0 END), 0)::bigint AS debt
          FROM ledger_entries e
          JOIN ledger_accounts a ON a.id = e.account_id`,
        this.prisma.refund.aggregate({
          where: { status: 'REQUESTED' },
          _sum: { amountMinor: true },
          _count: true,
        }),
        this.prisma.payout.aggregate({
          where: { status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING'] } },
          _sum: { amountMinor: true },
          _count: true,
        }),
        this.prisma.cashSettlement.count({ where: { status: 'DISPUTED' } }),
      ]);
    return {
      range: query.range,
      from: from.toISOString(),
      to: now.toISOString(),
      onlineVolume: money(online._sum.amountMinor ?? 0n),
      onlineCount: online._count,
      cashVolume: money(cash._sum.amountMinor ?? 0n),
      cashCount: cash._count,
      platformFees: money(fees[0]?.net ?? 0n),
      providerPayable: money(balances[0]?.payable ?? 0n),
      providerDebt: money(balances[0]?.debt ?? 0n),
      pendingRefunds: {
        count: pendingRefunds._count,
        amount: money(pendingRefunds._sum.amountMinor ?? 0n),
      },
      pendingPayouts: {
        count: pendingPayouts._count,
        amount: money(pendingPayouts._sum.amountMinor ?? 0n),
      },
      openCashDisputes,
      testMode: this.config.testMode,
    };
  }

  // -------------------------------------------------------------------------
  // Payments
  // -------------------------------------------------------------------------

  async listPayments(query: ListAdminPaymentsQuery): Promise<Paginated<AdminPaymentListItem>> {
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = new Date(`${query.from}T00:00:00+03:00`);
    if (query.to)
      createdAt.lt = new Date(new Date(`${query.to}T00:00:00+03:00`).getTime() + DAY_MS);
    const rows = await this.prisma.payment.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.method ? { method: query.method } : {}),
        ...(query.gateway ? { gateway: query.gateway } : {}),
        ...(query.from || query.to ? { createdAt } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      include: paymentListInclude,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const refunded = await this.refundedByPayment(page.map((p) => p.id));
    return {
      items: page.map((p) => this.toListItem(p, refunded.get(p.id) ?? 0n)),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async payment(id: string): Promise<AdminPaymentDetail> {
    const p = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        ...paymentListInclude,
        job: {
          select: {
            ...paymentListInclude.job.select,
            status: true,
            agreedPriceMinor: true,
            currentTotalMinor: true,
            currency: true,
          },
        },
        transactions: true,
        refunds: {
          include: { requestedBy: { select: { firstName: true, lastName: true } } },
          orderBy: { createdAt: 'asc' },
        },
        earning: { include: earningInclude },
      },
    });
    if (!p) throw paymentNotFound();
    const refundIds = p.refunds.map((r) => r.id);
    const [ledger, audit] = await Promise.all([
      this.prisma.ledgerTransaction.findMany({
        where: {
          OR: [
            { paymentId: id },
            ...(refundIds.length > 0 ? [{ refundId: { in: refundIds } }] : []),
            ...(p.earning ? [{ earningId: p.earning.id }] : []),
          ],
        },
        include: ledgerInclude,
        orderBy: { id: 'asc' },
      }),
      this.prisma.auditLog.findMany({
        where: {
          OR: [
            { entityType: 'payment', entityId: id },
            ...(refundIds.length > 0
              ? [{ entityType: 'refund', entityId: { in: refundIds } }]
              : []),
          ],
        },
        select: { action: true, entityType: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: 200,
      }),
    ]);
    const succeeded = p.refunds
      .filter((r) => r.status === 'SUCCEEDED')
      .reduce((a, r) => a + r.amountMinor, 0n);
    const nonFailed = p.refunds
      .filter((r) => r.status !== 'FAILED')
      .reduce((a, r) => a + r.amountMinor, 0n);
    const captured = (CAPTURED_PAYMENT_STATUSES as readonly string[]).includes(p.status);
    return {
      ...this.toListItem(p, succeeded),
      platformFee: money(p.platformFeeMinor, p.currency),
      feeBps: p.platformFeeBps,
      gatewayReference: p.gatewayReference,
      refundable: money(captured ? refundableAmount(p.amountMinor, nonFailed) : 0n, p.currency),
      testMode: this.config.testMode && p.gateway === 'mock',
      job: {
        status: p.job.status,
        agreedPrice: money(p.job.agreedPriceMinor, p.job.currency),
        currentTotal: money(p.job.currentTotalMinor, p.job.currency),
      },
      attempts: [...p.transactions]
        .sort((a, b) => a.attemptNumber - b.attemptNumber)
        .map(toAttempt),
      earning: p.earning ? toEarning(p.earning) : null,
      refunds: p.refunds.map((r): AdminRefund => ({
        id: r.id,
        amount: money(r.amountMinor, r.currency),
        feePortion: money(r.feePortionMinor, r.currency),
        providerPortion: money(r.providerPortionMinor, r.currency),
        status: r.status,
        reason: r.reason,
        internalNote: r.internalNote,
        requestedBy: r.requestedBy ? shortName(r.requestedBy) : null,
        failureCode: r.failureCode,
        createdAt: r.createdAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
      })),
      ledger: ledger.map(toLedgerView),
      audit: audit.map((a) => ({
        action: a.action,
        entityType: a.entityType,
        at: a.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Admin refund (full or partial). The amount is checked against what is
   * refundable under the job and payment row locks; `expectedRefundableMinor`
   * must match what the confirm screen showed, so a refund decided on stale
   * figures is refused. Idempotent on the Idempotency-Key.
   */
  async refund(
    adminId: string,
    paymentId: string,
    input: AdminRefundRequest,
    idempotencyKey: string,
    ipAddress: string | null,
  ): Promise<AdminPaymentDetail> {
    const key = `admin:${idempotencyKey}`;
    const existing = await this.prisma.refund.findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      if (existing.paymentId !== paymentId) throw idempotencyKeyReused();
      return this.payment(paymentId);
    }
    const ref = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: { jobId: true },
    });
    if (!ref) throw paymentNotFound();

    let refundId: string | null = null;
    try {
      refundId = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM jobs WHERE id = ${ref.jobId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM payments WHERE id = ${paymentId}::uuid FOR UPDATE`;
        const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
        const totals = await this.refunds.refundTotals(tx, paymentId);
        const refundable = (CAPTURED_PAYMENT_STATUSES as readonly string[]).includes(payment.status)
          ? refundableAmount(payment.amountMinor, totals.nonFailed)
          : 0n;
        if (refundable !== BigInt(input.expectedRefundableMinor)) {
          throw refundStale(Number(refundable));
        }
        const refund = await this.refunds.requestInTx(tx, {
          paymentId,
          amount: BigInt(input.amountMinor),
          reason: input.reason,
          note: input.note,
          requestedById: adminId,
          idempotencyKey: key,
          now: new Date(),
          ipAddress,
        });
        return refund.id;
      });
    } catch (error) {
      // A concurrent request with the same key won the unique index.
      if ((error as { code?: string }).code === 'P2002') {
        const winner = await this.prisma.refund.findUnique({ where: { idempotencyKey: key } });
        if (winner?.paymentId === paymentId) return this.payment(paymentId);
      }
      throw error;
    }
    await this.refunds.processAll([refundId]);
    return this.payment(paymentId);
  }

  // -------------------------------------------------------------------------
  // Ledger, payouts, cash
  // -------------------------------------------------------------------------

  async listLedger(query: ListAdminLedgerQuery): Promise<Paginated<LedgerTransactionView>> {
    const rows = await this.prisma.ledgerTransaction.findMany({
      where: {
        ...(query.type ? { type: query.type } : {}),
        ...(query.paymentId ? { paymentId: query.paymentId } : {}),
        ...(query.providerId ? { providerId: query.providerId } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      include: ledgerInclude,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toLedgerView),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async ledgerTransaction(id: string): Promise<LedgerTransactionView> {
    const row = await this.prisma.ledgerTransaction.findUnique({
      where: { id },
      include: ledgerInclude,
    });
    if (!row) throw notFound('LEDGER_TRANSACTION_NOT_FOUND', 'Defter kaydı bulunamadı.');
    return toLedgerView(row);
  }

  async listPayouts(query: ListAdminPayoutsQuery): Promise<Paginated<AdminPayout>> {
    const rows = await this.prisma.payout.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      include: { destination: true, provider: { select: { displayName: true } } },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toAdminPayout),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async listCash(query: ListAdminCashQuery): Promise<Paginated<AdminCashSettlement>> {
    const rows = await this.prisma.cashSettlement.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      include: adminCashInclude,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toAdminCash),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  // -------------------------------------------------------------------------

  private async refundedByPayment(ids: readonly string[]): Promise<Map<string, bigint>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.refund.groupBy({
      by: ['paymentId'],
      where: { paymentId: { in: [...ids] }, status: 'SUCCEEDED' },
      _sum: { amountMinor: true },
    });
    return new Map(rows.map((r) => [r.paymentId, r._sum.amountMinor ?? 0n]));
  }

  private toListItem(p: PaymentListRow, refunded: bigint): AdminPaymentListItem {
    return {
      id: p.id,
      jobId: p.jobId,
      jobTitle: p.job.serviceRequest.title,
      customerName: shortName(p.job.customer.user),
      providerName: p.job.provider.displayName,
      amount: money(p.amountMinor, p.currency),
      refunded: money(refunded, p.currency),
      method: 'IN_APP',
      gateway: p.gateway,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
    };
  }
}
