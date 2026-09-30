import { createHmac } from 'node:crypto';

import type { ApiEnv } from '../../config/env.js';

/**
 * Returns the configured secret, or outside production a key derived from
 * JWT_ACCESS_SECRET with a per-purpose label, so a developer does not have
 * to set one variable per feature. Production refuses to start without the
 * dedicated secret (packages/config api-env.ts), so derived keys never reach
 * production and rotating the JWT key there cannot change them.
 */
export function secretFor(
  env: ApiEnv,
  purpose: 'otp' | 'storage' | 'payment-webhook',
  configured: string | undefined,
): Buffer {
  if (configured) return Buffer.from(configured, 'utf8');
  if (env.NODE_ENV === 'production') {
    throw new Error(`Missing ${purpose} secret in production.`);
  }
  return createHmac('sha256', env.JWT_ACCESS_SECRET).update(`ustago:${purpose}:v1`).digest();
}
