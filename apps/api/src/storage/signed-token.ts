import { createHmac, timingSafeEqual } from 'node:crypto';

/** Claims of a local-storage URL token. */
export interface StorageTokenClaims {
  key: string;
  op: 'put' | 'get';
  /** Unix seconds. */
  exp: number;
  /** PUT only: required Content-Type and maximum body size. */
  ct?: string;
  max?: number;
}

/** `<base64url(json)>.<base64url(hmac)>`: compact, URL-safe, tamper-evident. */
export function signStorageToken(secret: Buffer, claims: StorageTokenClaims): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyStorageToken(
  secret: Buffer,
  token: string,
  now = Date.now(),
): StorageTokenClaims | null {
  const [payload, signature, ...rest] = token.split('.');
  if (!payload || !signature || rest.length > 0) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isClaims(claims) || claims.exp * 1000 <= now) return null;
  return claims;
}

function isClaims(value: unknown): value is StorageTokenClaims {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['key'] === 'string' &&
    (v['op'] === 'put' || v['op'] === 'get') &&
    typeof v['exp'] === 'number' &&
    (v['ct'] === undefined || typeof v['ct'] === 'string') &&
    (v['max'] === undefined || typeof v['max'] === 'number')
  );
}
