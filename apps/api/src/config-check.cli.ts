/**
 * `pnpm config:check` — validates the API environment exactly as the API
 * does at boot (docs/adr/0022) and prints the secret-free summary. Exits
 * with code 1 and lists every problem (variable names only, never values)
 * when the API would refuse to start. It reads `process.env` only;
 * `--local` also loads the repository's .env file first.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { apiEnvSchema, EnvValidationError, parseEnv, securitySummary } from '@ustago/config';

const out = (line: string) => process.stdout.write(`${line}\n`);

if (process.argv.includes('--local')) {
  const rootEnv = resolve(import.meta.dirname, '../../../.env');
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
}

try {
  const env = parseEnv(apiEnvSchema, process.env);
  for (const line of securitySummary(env)) out(line);
  out('Config OK: the API would start with this environment.');
} catch (error) {
  if (!(error instanceof EnvValidationError)) throw error;
  out('Config REFUSED: the API would not start.');
  for (const issue of error.issues) out(`  - ${issue}`);
  process.exitCode = 1;
}
