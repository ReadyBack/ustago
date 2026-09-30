// pnpm dev:seed: applies pending migrations and loads the demo data (idempotent).
import { migrateAndSeed } from './lib.mjs';

migrateAndSeed();
