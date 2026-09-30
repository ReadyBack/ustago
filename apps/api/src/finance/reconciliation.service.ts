import { Injectable } from '@nestjs/common';
import type { ReconciliationReport } from '@ustago/types';

import { PrismaService } from '../prisma/prisma.service.js';
import { type LedgerFact, reconcile } from './domain/reconciliation.js';
import { money } from './finance.mappers.js';

/**
 * Read-only reconciliation (docs/adr/0018): payments ↔ capture entries,
 * refunds ↔ refund entries, payouts ↔ reservation/release, cash ↔ fee,
 * plus the global double-entry invariant. It never writes and never
 * "fixes" anything. Used by the admin page and `pnpm finance:reconcile`.
 *
 * Faz 5 reads everything in a few set-based queries (development scale);
 * a production cron would page by date.
 */
@Injectable()
export class ReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async run(now = new Date()): Promise<ReconciliationReport> {
    const db = this.prisma;
    const facts = await db.$queryRaw<
      { source_key: string; debit: bigint; fee_credit: bigint }[]
    >`
      SELECT t.source_key,
             COALESCE(SUM(CASE WHEN e.direction = 'DEBIT' THEN e.amount_minor ELSE 0 END), 0)::bigint AS debit,
             COALESCE(SUM(CASE WHEN e.direction = 'CREDIT' AND a.type = 'PLATFORM_FEE_REVENUE' THEN e.amount_minor ELSE 0 END), 0)::bigint AS fee_credit
      FROM ledger_transactions t
      JOIN ledger_entries e ON e.journal_id = t.id
      JOIN ledger_accounts a ON a.id = e.account_id
      GROUP BY t.source_key`;
    const unbalanced = await db.$queryRaw<{ id: string }[]>`
      SELECT t.id FROM ledger_transactions t
      LEFT JOIN ledger_entries e ON e.journal_id = t.id
      GROUP BY t.id
      HAVING COUNT(e.id) < 2
         OR COALESCE(SUM(CASE WHEN e.direction = 'DEBIT' THEN e.amount_minor ELSE -e.amount_minor END), 0) <> 0`;
    const negative = await db.$queryRaw<{ id: string; type: string; balance: bigint }[]>`
      SELECT a.id, a.type::text AS type,
             SUM(CASE WHEN e.direction = 'CREDIT' THEN e.amount_minor ELSE -e.amount_minor END)::bigint AS balance
      FROM ledger_accounts a JOIN ledger_entries e ON e.account_id = a.id
      WHERE a.type IN ('PROVIDER_PENDING', 'PROVIDER_AVAILABLE', 'PROVIDER_RESERVED')
      GROUP BY a.id, a.type
      HAVING SUM(CASE WHEN e.direction = 'CREDIT' THEN e.amount_minor ELSE -e.amount_minor END) < 0`;
    const totals = await db.$queryRaw<{ debit: bigint; credit: bigint }[]>`
      SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount_minor ELSE 0 END), 0)::bigint AS debit,
             COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor ELSE 0 END), 0)::bigint AS credit
      FROM ledger_entries`;
    const [payments, refundSums, earnings, refunds, payouts, cash] = await Promise.all([
      db.payment.findMany({
        select: { id: true, status: true, amountMinor: true, platformFeeMinor: true },
      }),
      db.refund.groupBy({
        by: ['paymentId'],
        where: { status: 'SUCCEEDED' },
        _sum: { amountMinor: true },
      }),
      db.providerEarning.findMany({
        select: { id: true, paymentId: true, status: true, grossMinor: true, feeMinor: true },
      }),
      db.refund.findMany({ select: { id: true, status: true, amountMinor: true } }),
      db.payout.findMany({ select: { id: true, status: true, amountMinor: true } }),
      db.cashSettlement.findMany({ select: { id: true, status: true, feeMinor: true } }),
    ]);
    const ledger = new Map<string, LedgerFact>(
      facts.map((f) => [f.source_key, { amount: f.debit, feeCredit: f.fee_credit }]),
    );
    const refundedOf = new Map(refundSums.map((r) => [r.paymentId, r._sum.amountMinor ?? 0n]));
    const mismatches = reconcile({
      ledger,
      payments: payments.map((p) => ({
        id: p.id,
        status: p.status,
        amount: p.amountMinor,
        fee: p.platformFeeMinor,
        refundedSucceeded: refundedOf.get(p.id) ?? 0n,
      })),
      earnings: earnings.map((e) => ({
        id: e.id,
        paymentId: e.paymentId,
        status: e.status,
        gross: e.grossMinor,
        fee: e.feeMinor,
      })),
      refunds: refunds.map((r) => ({ id: r.id, status: r.status, amount: r.amountMinor })),
      payouts: payouts.map((p) => ({ id: p.id, status: p.status, amount: p.amountMinor })),
      cash: cash.map((c) => ({ id: c.id, status: c.status, fee: c.feeMinor })),
      unbalancedTransactions: unbalanced.map((u) => u.id),
      negativeProviderAccounts: negative.map((n) => ({
        accountId: n.id,
        type: n.type,
        balance: n.balance,
      })),
    });
    const t = totals[0] ?? { debit: 0n, credit: 0n };
    return {
      generatedAt: now.toISOString(),
      checked: {
        payments: payments.length,
        refunds: refunds.length,
        payouts: payouts.length,
        cashSettlements: cash.length,
        earnings: earnings.length,
        ledgerTransactions: facts.length,
      },
      totals: { debit: money(t.debit), credit: money(t.credit) },
      ledgerBalanced: t.debit === t.credit && unbalanced.length === 0,
      mismatches,
    };
  }
}
