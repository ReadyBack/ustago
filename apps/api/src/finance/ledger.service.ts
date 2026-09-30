import { Injectable } from '@nestjs/common';

import type {
  CurrencyCode,
  LedgerAccountType,
  LedgerTransaction,
  Prisma,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  type AccountRef,
  type BuiltTransaction,
  type LedgerLine,
  PROVIDER_ACCOUNT_TYPES,
  reversalLines,
  validateLines,
} from './domain/ledger.js';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService;

export interface LedgerRefs {
  jobId?: string | null;
  paymentId?: string | null;
  refundId?: string | null;
  payoutId?: string | null;
  cashSettlementId?: string | null;
  earningId?: string | null;
  providerId?: string | null;
}

export interface PostInput {
  built: BuiltTransaction;
  /** Unique per business event, e.g. "payment:<id>:captured". */
  sourceKey: string;
  refs: LedgerRefs;
  description: string;
  createdById?: string | null;
  currency?: CurrencyCode;
}

export interface ProviderBalances {
  pending: bigint;
  available: bigint;
  reserved: bigint;
  platformDebt: bigint;
}

const PLATFORM_OWNER = 'platform';
const ownerKey = (ref: AccountRef) => ref.providerId ?? PLATFORM_OWNER;
const accountKey = (ref: AccountRef) => `${ownerKey(ref)}:${ref.type}`;

/**
 * Writes and reads the double-entry ledger (docs/adr/0018). Transactions
 * are append-only; a correction is a new REVERSAL. Posting locks the
 * provider accounts it touches (SELECT … FOR UPDATE, ordered by id) so a
 * balance check and the entries that depend on it cannot interleave with
 * another request for the same provider. Platform accounts are not locked:
 * nothing checks their balance before writing.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates missing accounts and returns their ids. */
  async ensureAccounts(
    tx: Tx,
    refs: readonly AccountRef[],
    currency: CurrencyCode = 'TRY',
  ): Promise<Map<string, string>> {
    const unique = new Map(refs.map((r) => [accountKey(r), r]));
    const ids = new Map<string, string>();
    for (const [key, ref] of unique) {
      const owner = ownerKey(ref);
      const found = await tx.ledgerAccount.findUnique({
        where: { ownerKey_type_currency: { ownerKey: owner, type: ref.type, currency } },
        select: { id: true },
      });
      if (found) {
        ids.set(key, found.id);
        continue;
      }
      // Concurrent first use: ON CONFLICT keeps exactly one row.
      await tx.$executeRaw`
        INSERT INTO ledger_accounts (id, type, provider_id, owner_key, currency, created_at, updated_at)
        VALUES (gen_random_uuid(), ${ref.type}::"LedgerAccountType", ${ref.providerId ?? null}::uuid,
                ${owner}, ${currency}::"CurrencyCode", now(), now())
        ON CONFLICT (owner_key, type, currency) DO NOTHING`;
      const row = await tx.ledgerAccount.findUniqueOrThrow({
        where: { ownerKey_type_currency: { ownerKey: owner, type: ref.type, currency } },
        select: { id: true },
      });
      ids.set(key, row.id);
    }
    return ids;
  }

  /**
   * Locks all four accounts of a provider (creating them if needed), in a
   * fixed order. Every write that depends on a provider balance calls this
   * first, inside its transaction.
   */
  async lockProvider(tx: Tx, providerId: string, currency: CurrencyCode = 'TRY'): Promise<void> {
    const refs = PROVIDER_ACCOUNT_TYPES.map((type) => ({ type, providerId }));
    const ids = [...(await this.ensureAccounts(tx, refs, currency)).values()].sort();
    await tx.$queryRaw`
      SELECT id FROM ledger_accounts WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
  }

  /**
   * Books one financial event. Idempotent on `sourceKey`: the same event
   * posted twice returns the first transaction and writes nothing.
   */
  async post(tx: Tx, input: PostInput): Promise<LedgerTransaction> {
    const existing = await tx.ledgerTransaction.findUnique({
      where: { sourceKey: input.sourceKey },
    });
    if (existing) return existing;
    const lines = validateLines(input.built.lines);
    return this.write(tx, input.built.type, lines, input, null);
  }

  /** Books the mirror image of a transaction (at most once, DB unique). */
  async reverse(
    tx: Tx,
    originalId: string,
    input: Omit<PostInput, 'built'>,
  ): Promise<LedgerTransaction> {
    const existing = await tx.ledgerTransaction.findUnique({
      where: { reversesId: originalId },
    });
    if (existing) return existing;
    const original = await tx.ledgerTransaction.findUniqueOrThrow({
      where: { id: originalId },
      include: { entries: { include: { account: true } } },
    });
    const lines: LedgerLine[] = original.entries.map((e) => ({
      account: {
        type: e.account.type,
        ...(e.account.providerId ? { providerId: e.account.providerId } : {}),
      },
      direction: e.direction,
      amount: e.amountMinor,
    }));
    return this.write(tx, 'REVERSAL', validateLines(reversalLines(lines)), input, originalId);
  }

  private async write(
    tx: Tx,
    type: BuiltTransaction['type'],
    lines: LedgerLine[],
    input: Omit<PostInput, 'built'>,
    reversesId: string | null,
  ): Promise<LedgerTransaction> {
    const currency = input.currency ?? 'TRY';
    const providerIds = [
      ...new Set(lines.map((l) => l.account.providerId).filter((p): p is string => Boolean(p))),
    ].sort();
    for (const providerId of providerIds) await this.lockProvider(tx, providerId, currency);
    const accounts = await this.ensureAccounts(
      tx,
      lines.map((l) => l.account),
      currency,
    );
    const created = await tx.ledgerTransaction.create({
      data: {
        type,
        currency,
        sourceKey: input.sourceKey,
        description: input.description.slice(0, 300),
        jobId: input.refs.jobId ?? null,
        paymentId: input.refs.paymentId ?? null,
        refundId: input.refs.refundId ?? null,
        payoutId: input.refs.payoutId ?? null,
        cashSettlementId: input.refs.cashSettlementId ?? null,
        earningId: input.refs.earningId ?? null,
        providerId: input.refs.providerId ?? null,
        reversesId,
        createdById: input.createdById ?? null,
      },
    });
    await tx.ledgerEntry.createMany({
      data: lines.map((l) => ({
        transactionId: created.id,
        accountId: accounts.get(accountKey(l.account)) as string,
        direction: l.direction,
        amountMinor: l.amount,
        currency,
        paymentId: input.refs.paymentId ?? null,
        jobId: input.refs.jobId ?? null,
      })),
    });
    return created;
  }

  /** Current balances of a provider's accounts, from the entries. */
  async providerBalances(db: Db, providerId: string): Promise<ProviderBalances> {
    const rows = await db.$queryRaw<{ type: LedgerAccountType; balance: bigint }[]>`
      SELECT a.type,
             COALESCE(SUM(CASE
               WHEN (a.type = 'PROVIDER_PLATFORM_DEBT') = (e.direction = 'DEBIT') THEN e.amount_minor
               ELSE -e.amount_minor END), 0)::bigint AS balance
      FROM ledger_accounts a
      LEFT JOIN ledger_entries e ON e.account_id = a.id
      WHERE a.owner_key = ${providerId}
      GROUP BY a.type`;
    const of = (type: LedgerAccountType) => rows.find((r) => r.type === type)?.balance ?? 0n;
    return {
      pending: of('PROVIDER_PENDING'),
      available: of('PROVIDER_AVAILABLE'),
      reserved: of('PROVIDER_RESERVED'),
      platformDebt: of('PROVIDER_PLATFORM_DEBT'),
    };
  }

  /** What is still pending for one earning (captured − refunded − released). */
  async earningPendingBalance(db: Db, earningId: string): Promise<bigint> {
    const rows = await db.$queryRaw<{ balance: bigint }[]>`
      SELECT COALESCE(SUM(CASE WHEN e.direction = 'CREDIT' THEN e.amount_minor ELSE -e.amount_minor END), 0)::bigint AS balance
      FROM ledger_entries e
      JOIN ledger_accounts a ON a.id = e.account_id AND a.type = 'PROVIDER_PENDING'
      JOIN ledger_transactions t ON t.id = e.journal_id
      WHERE t.earning_id = ${earningId}::uuid`;
    return rows[0]?.balance ?? 0n;
  }

  /** Global invariant: Σ debit = Σ credit over the whole ledger. */
  async trialBalance(db: Db = this.prisma): Promise<{ debit: bigint; credit: bigint }> {
    const rows = await db.$queryRaw<{ debit: bigint; credit: bigint }[]>`
      SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount_minor ELSE 0 END), 0)::bigint AS debit,
             COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor ELSE 0 END), 0)::bigint AS credit
      FROM ledger_entries`;
    return rows[0] ?? { debit: 0n, credit: 0n };
  }
}
