import { Injectable, Logger } from '@nestjs/common';
import type { Paginated, ReconciliationMismatch, ReconciliationRun } from '@ustago/types';
import type { ListReconciliationRunsQuery } from '@ustago/validation';

import { conflict } from '../common/http/errors.js';
import { money } from '../finance/finance.mappers.js';
import { ReconciliationService } from '../finance/reconciliation.service.js';
import { type FinanceReconciliationRun, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AlertsService } from './alerts.service.js';
import { HeartbeatService, WORKERS } from './heartbeat.service.js';

/** A RUNNING row older than this belongs to a crashed process. */
const STALE_RUN_MS = 30 * 60 * 1000;
const MAX_STORED_MISMATCHES = 50;
/** Entries committed late can carry an earlier created_at; wait this long. */
const SNAPSHOT_SETTLE_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SnapshotCheck {
  checked: number;
  mismatches: { accountId: string; asOf: string }[];
  created: number;
}

/**
 * Scheduled and manual reconciliation runs (docs/adr/0025). Every run is
 * recorded; mismatches raise an operational alert. Nothing is ever fixed
 * automatically: the ledger, payments and balances are only read.
 */
@Injectable()
export class ReconciliationRunsService {
  private readonly logger = new Logger(ReconciliationRunsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reconciliation: ReconciliationService,
    private readonly alerts: AlertsService,
    private readonly heartbeat: HeartbeatService,
  ) {}

  async latest(): Promise<ReconciliationRun | null> {
    const row = await this.prisma.financeReconciliationRun.findFirst({ orderBy: { id: 'desc' } });
    return row ? toRun(row) : null;
  }

  async list(query: ListReconciliationRunsQuery): Promise<Paginated<ReconciliationRun>> {
    const rows = await this.prisma.financeReconciliationRun.findMany({
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toRun),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /** Whether a scheduled run is due (last started run older than the interval). */
  async isDue(intervalMinutes: number, now = new Date()): Promise<boolean> {
    if (intervalMinutes <= 0) return false;
    const last = await this.prisma.financeReconciliationRun.findFirst({
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true },
    });
    return !last || now.getTime() - last.startedAt.getTime() >= intervalMinutes * 60 * 1000;
  }

  /**
   * Runs once. Another run in progress (any replica) → 409 for manual
   * runs, silently skipped for scheduled ones.
   */
  async run(trigger: 'SCHEDULED' | 'MANUAL', now = new Date()): Promise<ReconciliationRun | null> {
    // The RUNNING row is the lock (unique index: one RUNNING row at most),
    // so replicas never reconcile concurrently.
    await this.prisma.financeReconciliationRun.updateMany({
      where: { status: 'RUNNING', startedAt: { lt: new Date(now.getTime() - STALE_RUN_MS) } },
      data: { status: 'FAILED', finishedAt: now, error: 'STALE_RUN' },
    });
    let run: FinanceReconciliationRun;
    try {
      run = await this.prisma.financeReconciliationRun.create({
        data: { trigger, startedAt: now },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        if (trigger === 'MANUAL') {
          throw conflict('RECONCILIATION_RUNNING', 'Bir mutabakat zaten çalışıyor.');
        }
        return null;
      }
      throw error;
    }
    return this.heartbeat.track(
      WORKERS.RECONCILIATION,
      () => this.execute(run, now),
      (r) => ({ status: r.status, mismatchCount: r.mismatchCount }),
    );
  }

  private async execute(run: FinanceReconciliationRun, now: Date): Promise<ReconciliationRun> {
    try {
      const report = await this.reconciliation.run(now);
      const snapshots = await this.checkSnapshots(now);
      const mismatches: ReconciliationMismatch[] = [
        ...report.mismatches,
        ...snapshots.mismatches.map((m) => ({
          kind: 'LEDGER_SNAPSHOT_CHANGED',
          entityType: 'ledger_account',
          entityId: m.accountId,
          message: `Günlük defter anlık görüntüsü (${m.asOf}) sonradan değişmiş.`,
        })),
      ];
      if (!report.ledgerBalanced) {
        mismatches.unshift({
          kind: 'LEDGER_UNBALANCED',
          entityType: 'ledger',
          entityId: 'global',
          message: 'Toplam borç ve alacak eşit değil.',
        });
      }
      let alertId: string | null = null;
      if (mismatches.length > 0) {
        alertId = await this.alerts.raise({
          type: 'finance.reconciliation_mismatch',
          severity: 'CRITICAL',
          title: `Finans mutabakatında ${mismatches.length} uyumsuzluk`,
          details: {
            runId: run.id,
            mismatchCount: mismatches.length,
            kinds: [...new Set(mismatches.map((m) => m.kind))],
          },
          source: 'reconciliation',
          dedupeKey: 'finance.reconciliation_mismatch',
        });
      } else {
        await this.alerts.autoResolve(
          'finance.reconciliation_mismatch',
          `Mutabakat ${run.id} temiz tamamlandı (otomatik kapandı).`,
        );
      }
      const updated = await this.prisma.financeReconciliationRun.update({
        where: { id: run.id },
        data: {
          status: 'SUCCEEDED',
          finishedAt: new Date(),
          counts: report.checked,
          debitTotalMinor: BigInt(report.totals.debit.amountMinor),
          creditTotalMinor: BigInt(report.totals.credit.amountMinor),
          mismatchCount: mismatches.length,
          mismatches: mismatches.slice(0, MAX_STORED_MISMATCHES).map((m) => ({ ...m })),
          snapshotsChecked: snapshots.checked,
          snapshotMismatchCount: snapshots.mismatches.length,
          alertId,
        },
      });
      return toRun(updated);
    } catch (error) {
      const name = error instanceof Error ? error.name : 'Error';
      this.logger.error({ msg: 'reconciliation_failed', runId: run.id, error: name });
      await this.prisma.financeReconciliationRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', finishedAt: new Date(), error: name },
      });
      await this.alerts.raise({
        type: 'finance.reconciliation_failed',
        severity: 'CRITICAL',
        title: 'Finans mutabakatı çalışamadı',
        details: { runId: run.id, error: name },
        source: 'reconciliation',
        dedupeKey: 'finance.reconciliation_failed',
      });
      throw error;
    }
  }

  /**
   * Daily per-account totals as of UTC midnight. A new day's snapshot is
   * written once the day has settled; earlier snapshots are compared with
   * the ledger as it is now. The ledger is append-only, so a difference
   * means history was changed and needs investigation.
   */
  async checkSnapshots(now = new Date()): Promise<SnapshotCheck> {
    const asOf = new Date(Math.floor((now.getTime() - SNAPSHOT_SETTLE_MS) / DAY_MS) * DAY_MS);
    const totals = await this.prisma.$queryRaw<
      { account_id: string; debit: bigint; credit: bigint; n: bigint }[]
    >`
      SELECT account_id,
             COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount_minor ELSE 0 END), 0)::bigint AS debit,
             COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor ELSE 0 END), 0)::bigint AS credit,
             COUNT(*)::bigint AS n
      FROM ledger_entries WHERE created_at < ${asOf}
      GROUP BY account_id`;
    const existing = await this.prisma.ledgerAccountSnapshot.findMany({ where: { asOf } });
    const known = new Map(existing.map((s) => [s.accountId, s]));
    const mismatches: SnapshotCheck['mismatches'] = [];
    const toCreate: Prisma.LedgerAccountSnapshotCreateManyInput[] = [];
    for (const t of totals) {
      const snap = known.get(t.account_id);
      if (!snap) {
        toCreate.push({
          accountId: t.account_id,
          asOf,
          debitTotalMinor: t.debit,
          creditTotalMinor: t.credit,
          entryCount: Number(t.n),
        });
      } else if (
        snap.debitTotalMinor !== t.debit ||
        snap.creditTotalMinor !== t.credit ||
        snap.entryCount !== Number(t.n)
      ) {
        mismatches.push({ accountId: t.account_id, asOf: asOf.toISOString() });
      }
      known.delete(t.account_id);
    }
    // A snapshot whose account has no entries before asOf any more.
    for (const snap of known.values()) {
      mismatches.push({ accountId: snap.accountId, asOf: asOf.toISOString() });
    }
    if (toCreate.length > 0) {
      await this.prisma.ledgerAccountSnapshot.createMany({ data: toCreate, skipDuplicates: true });
    }
    return { checked: existing.length, mismatches, created: toCreate.length };
  }
}

export function toRun(r: FinanceReconciliationRun): ReconciliationRun {
  const durationMs = r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null;
  return {
    id: r.id,
    trigger: r.trigger === 'MANUAL' ? 'MANUAL' : 'SCHEDULED',
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    durationMs,
    counts: (r.counts ?? null) as Record<string, number> | null,
    mismatches: Array.isArray(r.mismatches)
      ? (r.mismatches as unknown as ReconciliationMismatch[])
      : [],
    totals:
      r.debitTotalMinor !== null && r.creditTotalMinor !== null
        ? { debit: money(r.debitTotalMinor), credit: money(r.creditTotalMinor) }
        : null,
    mismatchCount: r.mismatchCount ?? 0,
    snapshotsChecked: r.snapshotsChecked,
    snapshotMismatchCount: r.snapshotMismatchCount,
    error: r.error,
    alertId: r.alertId,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
