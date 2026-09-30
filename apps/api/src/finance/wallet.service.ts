import { Injectable, Inject } from '@nestjs/common';
import type {
  LedgerTransactionType,
  Paginated,
  ProviderEarning,
  Wallet,
  WalletBucket,
  WalletLine,
  WalletStatement,
} from '@ustago/types';
import type { ListWalletQuery } from '@ustago/validation';

import type { LedgerAccountType, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { withdrawable } from './domain/earning.js';
import { signedEffect } from './domain/ledger.js';
import { RESERVED_PAYOUT_STATUSES } from './domain/payout.js';
import { FINANCE_CONFIG, type FinanceConfig } from './finance.config.js';
import { earningNotFound } from './finance-errors.js';
import { money, toDestination, toPayout } from './finance.mappers.js';
import { LedgerService } from './ledger.service.js';
import { PayoutsService } from './payouts.service.js';

const BUCKET: Partial<Record<LedgerAccountType, WalletBucket>> = {
  PROVIDER_PENDING: 'PENDING',
  PROVIDER_AVAILABLE: 'AVAILABLE',
  PROVIDER_RESERVED: 'RESERVED',
  PROVIDER_PLATFORM_DEBT: 'PLATFORM_DEBT',
};

/** Turkish line labels for the provider's transaction list. */
export const WALLET_LABELS: Record<LedgerTransactionType, string> = {
  PAYMENT_CAPTURED: 'Müşteri ödemesi (beklemede)',
  EARNING_RELEASED: 'Kazanç kullanılabilir oldu',
  CASH_FEE_ASSESSED: 'Nakit iş platform hizmet bedeli',
  REFUND_REQUESTED: 'Müşteriye iade',
  REFUND_COMPLETED: 'İade tamamlandı',
  PAYOUT_RESERVED: 'Para çekme talebi',
  PAYOUT_PAID: 'Para çekme ödendi',
  PAYOUT_RELEASED: 'Para çekme iptal / başarısız',
  REVERSAL: 'Düzeltme (ters kayıt)',
  ADJUSTMENT: 'Düzeltme',
};

export const earningInclude = {
  job: {
    select: {
      serviceRequest: { select: { title: true } },
      category: { select: { name: true } },
    },
  },
  payment: { select: { refunds: { where: { status: { not: 'FAILED' } }, select: { providerPortionMinor: true } } } },
} satisfies Prisma.ProviderEarningInclude;

/**
 * "Kazançlarım" (docs/adr/0020). Every number is read from the ledger (or,
 * for cash job volume, from confirmed cash settlements, which UstaGO never
 * held); there is no stored balance anywhere.
 */
@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly payouts: PayoutsService,
    @Inject(FINANCE_CONFIG) private readonly config: FinanceConfig,
  ) {}

  async wallet(userId: string, now = new Date()): Promise<Wallet> {
    const providerId = await this.payouts.providerIdOf(userId);
    const balances = await this.ledger.providerBalances(this.prisma, providerId);
    const held = await this.heldBalance(providerId);
    const paidOut = await this.paidOut(providerId);
    const startOfMonth = monthStartIstanbul(now);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
    const [thisMonth, last30] = await Promise.all([
      this.statement(providerId, 'THIS_MONTH', startOfMonth, now),
      this.statement(providerId, 'LAST_30_DAYS', thirtyDaysAgo, now),
    ]);
    const next = await this.prisma.providerEarning.findFirst({
      where: { providerId, status: 'PENDING', holdUntil: { not: null } },
      orderBy: { holdUntil: 'asc' },
      select: { holdUntil: true },
    });
    const destination = await this.prisma.payoutDestination.findFirst({
      where: { providerId, deactivatedAt: null },
    });
    const pendingPayouts = await this.prisma.payout.findMany({
      where: { providerId, status: { in: [...RESERVED_PAYOUT_STATUSES] } },
      include: { destination: true },
      orderBy: { createdAt: 'desc' },
    });
    const recent = await this.lines(providerId, { limit: 10 });
    return {
      balances: {
        pending: money(balances.pending),
        held: money(held),
        available: money(balances.available),
        reserved: money(balances.reserved),
        platformDebt: money(balances.platformDebt),
        withdrawable: money(withdrawable(balances.available, balances.platformDebt)),
        paidOut: money(paidOut),
      },
      statements: [thisMonth, last30],
      nextReleaseAt: next?.holdUntil?.toISOString() ?? null,
      minPayout: money(this.config.minPayoutMinor),
      payoutsEnabled: this.config.payoutsEnabled && this.config.payoutProvider !== 'disabled',
      testMode: this.config.testMode,
      destination: destination ? toDestination(destination) : null,
      recent: recent.items,
      pendingPayouts: pendingPayouts.map(toPayout),
    };
  }

  async transactions(userId: string, query: ListWalletQuery): Promise<Paginated<WalletLine>> {
    const providerId = await this.payouts.providerIdOf(userId);
    return this.lines(providerId, query);
  }

  private async lines(
    providerId: string,
    query: { limit: number; cursor?: string },
  ): Promise<Paginated<WalletLine>> {
    const rows = await this.prisma.ledgerTransaction.findMany({
      where: { providerId, ...(query.cursor ? { id: { lt: query.cursor } } : {}) },
      include: {
        entries: { include: { account: { select: { type: true, ownerKey: true } } } },
        job: { select: { serviceRequest: { select: { title: true } } } },
        reverses: { select: { type: true } },
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((t) => {
        const changes = new Map<WalletBucket, bigint>();
        for (const e of t.entries) {
          const bucket = BUCKET[e.account.type];
          if (!bucket || e.account.ownerKey !== providerId) continue;
          changes.set(
            bucket,
            (changes.get(bucket) ?? 0n) + signedEffect(e.account.type, e.direction, e.amountMinor),
          );
        }
        return {
          transactionId: t.id,
          type: t.type,
          label:
            t.type === 'REVERSAL' && t.reverses
              ? `${WALLET_LABELS[t.reverses.type]} (geri alındı)`
              : WALLET_LABELS[t.type],
          jobTitle: t.job?.serviceRequest.title ?? null,
          createdAt: t.createdAt.toISOString(),
          changes: [...changes.entries()]
            .filter(([, v]) => v !== 0n)
            .map(([bucket, v]) => ({ bucket, amount: money(v) })),
        };
      }),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async earnings(userId: string, query: ListWalletQuery): Promise<Paginated<ProviderEarning>> {
    const providerId = await this.payouts.providerIdOf(userId);
    const rows = await this.prisma.providerEarning.findMany({
      where: { providerId, ...(query.cursor ? { id: { lt: query.cursor } } : {}) },
      include: earningInclude,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toEarning),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async earning(userId: string, id: string): Promise<ProviderEarning> {
    const providerId = await this.payouts.providerIdOf(userId);
    const row = await this.prisma.providerEarning.findUnique({ where: { id }, include: earningInclude });
    if (!row || row.providerId !== providerId) throw earningNotFound();
    return toEarning(row);
  }

  /** Pending money frozen by open disputes. */
  private async heldBalance(providerId: string): Promise<bigint> {
    const rows = await this.prisma.$queryRaw<{ held: bigint }[]>`
      SELECT COALESCE(SUM(CASE WHEN e.direction = 'CREDIT' THEN e.amount_minor ELSE -e.amount_minor END), 0)::bigint AS held
      FROM provider_earnings pe
      JOIN ledger_transactions t ON t.earning_id = pe.id
      JOIN ledger_entries e ON e.journal_id = t.id
      JOIN ledger_accounts a ON a.id = e.account_id AND a.type = 'PROVIDER_PENDING'
      WHERE pe.provider_id = ${providerId}::uuid AND pe.status = 'HELD'`;
    return rows[0]?.held ?? 0n;
  }

  private async paidOut(providerId: string, from?: Date, to?: Date): Promise<bigint> {
    const rows = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COALESCE(SUM(e.amount_minor), 0)::bigint AS total
      FROM ledger_transactions t
      JOIN ledger_entries e ON e.journal_id = t.id AND e.direction = 'DEBIT'
      WHERE t.provider_id = ${providerId}::uuid AND t.type = 'PAYOUT_PAID'
        AND t.created_at >= ${from ?? new Date(0)} AND t.created_at <= ${to ?? new Date('9999-12-31')}`;
    return rows[0]?.total ?? 0n;
  }

  /**
   * Period summary. Online gross and fees come from the ledger; cash gross
   * from confirmed cash settlements (UstaGO never held that money).
   * net = gross − platform fees − the provider's part of refunds.
   */
  private async statement(
    providerId: string,
    period: WalletStatement['period'],
    from: Date,
    to: Date,
  ): Promise<WalletStatement> {
    const rows = await this.prisma.$queryRaw<
      { online_gross: bigint; fee_net: bigint; provider_refunds: bigint }[]
    >`
      SELECT
        COALESCE(SUM(CASE WHEN t.type = 'PAYMENT_CAPTURED' AND a.type = 'PLATFORM_CLEARING' THEN e.amount_minor ELSE 0 END), 0)::bigint AS online_gross,
        COALESCE(SUM(CASE WHEN a.type = 'PLATFORM_FEE_REVENUE'
          THEN (CASE WHEN e.direction = 'CREDIT' THEN e.amount_minor ELSE -e.amount_minor END) ELSE 0 END), 0)::bigint AS fee_net,
        COALESCE(SUM(CASE WHEN (t.type = 'REFUND_REQUESTED' OR (t.type = 'REVERSAL' AND r.type = 'REFUND_REQUESTED'))
            AND a.type IN ('PROVIDER_PENDING', 'PROVIDER_AVAILABLE', 'PROVIDER_PLATFORM_DEBT')
          THEN (CASE WHEN e.direction = 'DEBIT' THEN e.amount_minor ELSE -e.amount_minor END) ELSE 0 END), 0)::bigint AS provider_refunds
      FROM ledger_transactions t
      LEFT JOIN ledger_transactions r ON r.id = t.reverses_id
      JOIN ledger_entries e ON e.journal_id = t.id
      JOIN ledger_accounts a ON a.id = e.account_id
      WHERE t.provider_id = ${providerId}::uuid AND t.created_at >= ${from} AND t.created_at <= ${to}`;
    const cash = await this.prisma.cashSettlement.aggregate({
      where: { providerId, status: 'CONFIRMED', confirmedAt: { gte: from, lte: to } },
      _sum: { amountMinor: true },
    });
    const r = rows[0] ?? { online_gross: 0n, fee_net: 0n, provider_refunds: 0n };
    const gross = r.online_gross + (cash._sum.amountMinor ?? 0n);
    // Refund debits to "platform debt" are the provider owing money back:
    // they count as refunds too (signs above already net that out).
    const refunds = r.provider_refunds;
    return {
      period,
      from: from.toISOString(),
      to: to.toISOString(),
      grossJobValue: money(gross),
      platformFees: money(r.fee_net),
      netEarnings: money(gross - r.fee_net - refunds),
      paidOut: money(await this.paidOut(providerId, from, to)),
    };
  }
}

export function toEarning(
  e: Prisma.ProviderEarningGetPayload<{ include: typeof earningInclude }>,
): ProviderEarning {
  const refunded = e.payment.refunds.reduce((a, r) => a + r.providerPortionMinor, 0n);
  return {
    id: e.id,
    jobId: e.jobId,
    jobTitle: e.job.serviceRequest.title,
    categoryName: e.job.category.name,
    gross: money(e.grossMinor, e.currency),
    platformFee: money(e.feeMinor, e.currency),
    net: money(e.netMinor, e.currency),
    refunded: money(refunded, e.currency),
    feeBps: e.feeBps,
    status: e.status,
    holdUntil: e.holdUntil?.toISOString() ?? null,
    releasedAt: e.releasedAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
  };
}

/** First instant of the current month in Europe/Istanbul (UTC+3, no DST). */
export function monthStartIstanbul(now: Date): Date {
  const local = new Date(now.getTime() + 3 * 3_600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - 3 * 3_600_000);
}
