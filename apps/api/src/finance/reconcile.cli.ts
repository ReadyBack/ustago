/**
 * `pnpm finance:reconcile` — read-only reconciliation report of the local
 * database (docs/adr/0018). Prints a summary and every mismatch; exits
 * with code 1 when something does not match. It never writes: the report
 * runs in a READ ONLY transaction. `--json` prints the raw report.
 */
import 'reflect-metadata';

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { formatMoney } from '@ustago/validation';

import { PrismaClient } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ReconciliationService } from './reconciliation.service.js';

const rootEnv = resolve(import.meta.dirname, '../../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is not set.');

/** A CLI report goes to stdout. */
const out = (line: string) => process.stdout.write(`${line}\n`);

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

try {
  const report = await new ReconciliationService(prisma as unknown as PrismaService).run();
  if (process.argv.includes('--json')) {
    out(JSON.stringify(report, null, 2));
  } else {
    const c = report.checked;
    out('UstaGO finans mutabakatı (salt okunur)');
    out(`Zaman: ${report.generatedAt}`);
    out(
      `Kontrol edilen: ${c.payments} ödeme, ${c.refunds} iade, ${c.earnings} kazanç, ` +
        `${c.payouts} para çekme, ${c.cashSettlements} nakit kayıt, ${c.ledgerTransactions} defter kaydı`,
    );
    out(
      `Toplam borç ${formatMoney(report.totals.debit.amountMinor)} / alacak ${formatMoney(report.totals.credit.amountMinor)} → ` +
        (report.ledgerBalanced ? 'DENGELİ' : 'DENGESİZ'),
    );
    if (report.mismatches.length === 0) {
      out('Uyumsuzluk: 0');
    } else {
      out(`Uyumsuzluk: ${report.mismatches.length}`);
      for (const m of report.mismatches) {
        out(`- [${m.kind}] ${m.entityType} ${m.entityId}: ${m.message}`);
      }
    }
  }
  process.exitCode = report.ledgerBalanced && report.mismatches.length === 0 ? 0 : 1;
} finally {
  await prisma.$disconnect();
}
