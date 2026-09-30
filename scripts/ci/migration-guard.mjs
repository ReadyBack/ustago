#!/usr/bin/env node
/**
 * Migrations after Faz 5 are additive only (docs/adr/0021): no existing
 * table or column is dropped, renamed or retyped and no rows are deleted,
 * so payments, refunds, ledger, earnings and payouts survive every deploy.
 * A later migration that truly needs one of these must be reviewed and
 * listed in ALLOWED with the reason.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'apps/api/prisma/migrations';
const FROZEN_UP_TO = '20261002090000_phase5_finance_ledger';
const ALLOWED = new Set([]);
const RULES = {
  'DROP TABLE': /\bDROP\s+TABLE\b/i,
  'DROP COLUMN': /\bDROP\s+COLUMN\b/i,
  'column type change': /\bALTER\s+COLUMN\s+"?\w+"?\s+(SET\s+DATA\s+)?TYPE\b/i,
  RENAME: /\bRENAME\s+(COLUMN|TO)\b/i,
  TRUNCATE: /\bTRUNCATE\b/i,
  'DELETE FROM': /\bDELETE\s+FROM\b/i,
};

const stripComments = (sql) => sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const problems = [];
const checked = [];
for (const name of readdirSync(DIR).sort()) {
  if (name <= FROZEN_UP_TO || ALLOWED.has(name) || !/^\d{14}_/.test(name)) continue;
  const sql = stripComments(readFileSync(join(DIR, name, 'migration.sql'), 'utf8'));
  // Function bodies (triggers) may legitimately mention these words.
  const outsideFunctions = sql.replace(/\$\$[\s\S]*?\$\$/g, '');
  checked.push(name);
  for (const [label, re] of Object.entries(RULES)) {
    if (re.test(outsideFunctions)) problems.push(`${name}: ${label}`);
  }
}
if (problems.length > 0) {
  console.error(`Non-additive migration statements:\n${problems.join('\n')}`);
  process.exit(1);
}
console.log(`Migration guard: ${checked.length} post-Faz 5 migration(s) are additive.`);
