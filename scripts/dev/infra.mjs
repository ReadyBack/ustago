// pnpm dev:infra: PostgreSQL + Redis in Docker, waits until healthy.
import { startInfra } from './lib.mjs';

startInfra();
