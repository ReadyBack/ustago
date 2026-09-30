/**
 * Log redaction (Faz 6, docs/adr/0026). Keys are matched case-insensitively
 * and anywhere in nested objects; values are replaced, never partially kept.
 * Data classification: docs/security/data-classification.md.
 */
const SENSITIVE_KEYS = [
  'password',
  'passwordhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'secret',
  'otp',
  'code',
  'iban',
  'phone',
  'email',
  'tckn',
  'nationalid',
  'ipaddress',
  'ip',
  'address',
  'addressline',
  'storagekey',
  'pushtoken',
  'signature',
  'cardnumber',
  'cvv',
];

const SENSITIVE = new Set(SENSITIVE_KEYS);
const MAX_DEPTH = 6;

export const REDACTED = '[REDACTED]';

export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[-_]/g, '');
  if (SENSITIVE.has(k)) return true;
  return (
    k.endsWith('token') ||
    k.endsWith('secret') ||
    k.endsWith('password') ||
    k.endsWith('iban') ||
    k.endsWith('phone')
  );
}

/** Patterns redacted inside free-text messages. */
const TEXT_PATTERNS: [RegExp, string][] = [
  [/\bTR\d{2}[\d ]{10,30}\b/gi, '[IBAN]'],
  [/\+?90[\s-]?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g, '[PHONE]'],
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '[EMAIL]'],
  [/\bBearer\s+[\w-]+\.[\w-]+\.[\w-]+/gi, 'Bearer [TOKEN]'],
  [/\b\d{11}\b/g, '[11-DIGIT]'],
  [/postgres(?:ql)?:\/\/[^\s]+/gi, '[DATABASE_URL]'],
  [/rediss?:\/\/[^\s]+/gi, '[REDIS_URL]'],
];

export function redactText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of TEXT_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[TRUNCATED]';
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: redactText(value.message) };
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redact(v, depth + 1);
  }
  return out;
}
