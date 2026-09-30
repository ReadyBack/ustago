import { idempotencyKeySchema } from '@ustago/validation';
import type { Request } from 'express';

import { badRequest } from '../common/http/errors.js';

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/**
 * The `Idempotency-Key` header every money-moving endpoint requires.
 * Stored in a unique column, so the same key can never create a second
 * payment, refund or payout (docs/adr/0018).
 */
export function idempotencyKeyFrom(req: Request): string {
  const parsed = idempotencyKeySchema.safeParse(req.header(IDEMPOTENCY_HEADER) ?? undefined);
  if (!parsed.success) {
    throw badRequest(
      'IDEMPOTENCY_KEY_REQUIRED',
      'Bu işlem için geçerli bir Idempotency-Key başlığı gerekli.',
    );
  }
  return parsed.data;
}
