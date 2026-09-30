/**
 * `pnpm db:checksum` — migration regression helper (Faz 7). Prints the row
 * count and an MD5 over every row of the tables a migration must never
 * change (finance, jobs, reviews, verification, sessions, audit;
 * docs/adr/0021). Run it before and after `pnpm db:deploy` and diff:
 *
 *   pnpm --silent db:checksum > before.txt
 *   pnpm db:deploy
 *   pnpm --silent db:checksum > after.txt && diff before.txt after.txt
 *
 * Read-only.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/prisma/client.js';

const rootEnv = resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is not set.');

const TABLES = [
  'payments',
  'payment_transactions',
  'refunds',
  'ledger_accounts',
  'ledger_transactions',
  'ledger_entries',
  'provider_earnings',
  'payouts',
  'cash_settlements',
  'platform_fee_policies',
  'jobs',
  'job_status_history',
  'change_orders',
  'reviews',
  'provider_verifications',
  'provider_verification_cases',
  'provider_suspensions',
  'auth_sessions',
  'refresh_tokens',
  'audit_logs',
] as const;

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
try {
  for (const table of TABLES) {
    const rows = await prisma.$queryRawUnsafe<{ n: number; h: string }[]>(
      `SELECT count(*)::int AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '-') AS h
         FROM "${table}" t`,
    );
    const row = rows[0];
    process.stdout.write(`${table.padEnd(28)} rows=${String(row?.n).padStart(6)} md5=${row?.h}\n`);
  }
} finally {
  await prisma.$disconnect();
}
