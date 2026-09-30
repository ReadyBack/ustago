// Runs TypeScript with SWC so Nest's dependency injection gets the
// decorator metadata it needs (tsx/esbuild does not emit it). Used by the
// database seed, whose DEMO finance step drives the real API services.
//   node --import ./scripts/register-swc.mjs src/seed/main.ts
import { register } from 'node:module';

register('./swc-hooks.mjs', import.meta.url);
