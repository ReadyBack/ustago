#!/usr/bin/env node
/**
 * Fails when a tracked file looks like it carries a real credential
 * (docs/adr/0022). Cheap pattern scan, not a replacement for a dedicated
 * scanner; it prints file:line and the pattern name, never the match.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PATTERNS = {
  'AWS access key': /AKIA[0-9A-Z]{16}/,
  'private key': /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  'GitHub token': /\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{36}\b|github_pat_[A-Za-z0-9_]{40,}/,
  'Slack token': /xox[abprs]-[A-Za-z0-9-]{10,}/,
  'Stripe live key': /\b[sr]k_live_[A-Za-z0-9]{16,}/,
  'Anthropic key': /sk-ant-[A-Za-z0-9_-]{20,}/,
  'Google API key': /AIza[0-9A-Za-z_-]{35}/,
  JWT: /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
};
const FORBIDDEN_FILES = /(^|\/)(\.env(\.(?!example$)[\w.-]+)?|id_rsa|[^/]+\.(pem|p12|pfx|key))$/;
const SKIP = /(^|\/)(pnpm-lock\.yaml|generated\/)|\.(png|jpe?g|gif|webp|pdf|ico|ttf|woff2?)$/;

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const findings = [];
for (const file of files) {
  if (FORBIDDEN_FILES.test(file)) findings.push(`${file}: file must not be committed`);
  if (SKIP.test(file)) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  text.split('\n').forEach((line, i) => {
    for (const [name, re] of Object.entries(PATTERNS)) {
      if (re.test(line)) findings.push(`${file}:${i + 1}: looks like a ${name}`);
    }
  });
}
if (findings.length > 0) {
  console.error(`Secret scan failed (${findings.length}):\n${findings.join('\n')}`);
  process.exit(1);
}
console.log(`Secret scan: ${files.length} tracked files, nothing found.`);
