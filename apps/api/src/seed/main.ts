/**
 * Database seed. Run with `pnpm db:seed` (also runs after `prisma migrate reset`).
 *
 * - Reference data (81 provinces, pilot districts, starting categories) is
 *   seeded in every environment.
 * - Demo accounts are seeded only when NODE_ENV is not production.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client.js';
import { recalculateAllScores, seedDemoHistory } from './seed-demo-history.js';
import { seedDevData } from './seed-dev.js';
import { seedReferenceData } from './seed-reference.js';

const rootEnv = resolve(import.meta.dirname, '../../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is not set.');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

try {
  const reference = await seedReferenceData(prisma);
  console.warn(
    `Reference data: +${reference.provinces} provinces, +${reference.districts} districts, +${reference.categories} categories.`,
  );

  if (process.env['NODE_ENV'] === 'production') {
    console.warn('NODE_ENV=production: demo accounts skipped.');
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
    const history = await seedDemoHistory(prisma);
    console.warn(`DEMO job history: +${history} completed jobs with reviews.`);
    const scored = await recalculateAllScores(prisma);
    console.warn(`UstaScore V1 snapshots recomputed for ${scored} providers.`);
    if (dev.generatedPassword) {
      console.warn(
        `Generated password for the new demo accounts (shown once, not stored): ${dev.generatedPassword}`,
      );
    }
  }
} finally {
  await prisma.$disconnect();
}
