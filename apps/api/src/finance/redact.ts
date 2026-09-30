/**
 * Removes secrets and card data from provider payloads before they are
 * logged or stored (docs/adr/0019). Card numbers never reach UstaGO in the
 * first place (hosted payment / tokens), this is the second line.
 */
const SECRET_KEY = /(token|secret|signature|password|authorization|api[-_]?key|cvv|cvc|pan|card[-_]?number|iban)/i;
const CARD_LIKE = /\b\d{12,19}\b/g;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[depth]';
  if (typeof value === 'string') return value.replace(CARD_LIKE, '[redacted-number]');
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = SECRET_KEY.test(key) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Header map with signatures/authorization removed. */
export function redactHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  return redact(headers) as Record<string, unknown>;
}
