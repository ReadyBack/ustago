/**
 * Database seed. Run with `pnpm db:seed` (also runs after `prisma migrate reset`).
 *
 * - Reference data (81 provinces, pilot districts, starting categories) is
 *   seeded in every environment.
 * - Demo accounts, DEMO verification states and DEMO finance data (TEST
 *   money, mock provider) are seeded only when DEMO_SEED is on. DEMO_SEED
 *   defaults to on in development/test and the API config refuses it in
 *   staging/production (docs/adr/0022), so a production seed writes
 *   reference data only. Finance steps run through the real API services
 *   in a Nest application context.
 */
import 'reflect-metadata';

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { INestApplicationContext } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { apiEnvSchema, isStrictEnv, parseEnv } from '@ustago/config';

import { PrismaClient } from '../generated/prisma/client.js';
import { seedDemoFinance } from './seed-demo-finance.js';
import { recalculateAllScores, seedDemoHistory } from './seed-demo-history.js';
import { seedDemoTrust } from './seed-demo-trust.js';
import { seedDevData } from './seed-dev.js';
import { ensureDevFeePolicy } from './seed-finance.js';
import { seedReferenceData } from './seed-reference.js';

const rootEnv = resolve(import.meta.dirname, '../../../../.env');
// Never in a production build (docs/adr/0022): see src/main.ts.
if (process.env['NODE_ENV'] !== 'production' && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is not set.');
// Same validation as the API: a staging/production seed with DEMO_SEED=true
// (or any other unsafe setting) fails here, before touching the database.
const env = parseEnv(apiEnvSchema, process.env);
const demo = env.DEMO_SEED && !isStrictEnv(env.APP_ENV);

/** The API's services without HTTP, for seed steps that must use them. */
async function withAppContext<T>(fn: (app: INestApplicationContext) => Promise<T>): Promise<T> {
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../app.module.js');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    return await fn(app);
  } finally {
    await app.close();
  }
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

try {
  const reference = await seedReferenceData(prisma);
  console.warn(
    `Reference data: +${reference.provinces} provinces, +${reference.districts} districts, +${reference.categories} categories.`,
  );

  if (!demo) {
    console.warn(`APP_ENV=${env.APP_ENV}, DEMO_SEED off: demo data skipped.`);
  } else {
    const dev = await seedDevData(prisma, process.env['SEED_DEV_PASSWORD'] || undefined);
    console.warn(`Demo accounts created: ${dev.created.join(', ') || 'none'}.`);
    if (dev.existing.length > 0) {
      console.warn(
        `Already present: ${dev.existing.join(', ')} (password ${
          process.env['SEED_DEV_PASSWORD'] ? 'reset to SEED_DEV_PASSWORD' : 'unchanged'
        }).`,
      );
    }
    const trust = await seedDemoTrust(prisma);
    console.warn(
      `DEMO verification states: +${trust} providers (VERIFIED/SUBMITTED/NEEDS_REVISION/SUSPENDED).`,
    );
    const history = await seedDemoHistory(prisma);
    console.warn(`DEMO job history: +${history} completed jobs with reviews.`);
    const scored = await recalculateAllScores(prisma);
    console.warn(`UstaScore V1 snapshots recomputed for ${scored} providers.`);
    const policy = await ensureDevFeePolicy(prisma);
    console.warn(
      `Development fee policy (15 %, not a commercial rate): ${policy ? 'created' : 'already present'}.`,
    );
    const finance = await withAppContext((app) => seedDemoFinance(prisma, app));
    console.warn(
      `DEMO finance (TEST money only, idempotent — present after this run): ${finance.jobs} jobs, ${finance.payments} online payments, ` +
        `${finance.cash} cash, ${finance.refunds} refund, ${finance.payouts} payout.`,
    );
    if (dev.generatedPassword) {
      console.warn(
        `Generated password for the new demo accounts (shown once, not stored): ${dev.generatedPassword}`,
      );
    }
  }
} finally {
  await prisma.$disconnect();
}
