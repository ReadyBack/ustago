import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Pure OTP primitives (docs/adr/0009):
 * - codes come from the CSPRNG (crypto.randomInt), uniformly distributed;
 * - only HMAC-SHA256(secret, challengeId + ":" + code) is stored, so a
 *   database leak does not reveal codes and a hash cannot be reused for
 *   another challenge;
 * - comparison is constant-time.
 */
export function generateOtpCode(length: number): string {
  if (!Number.isInteger(length) || length < 4 || length > 8) {
    throw new RangeError('OTP length must be 4-8 digits');
  }
  return String(randomInt(0, 10 ** length)).padStart(length, '0');
}

export function hashOtpCode(secret: Buffer, challengeId: string, code: string): string {
  return createHmac('sha256', secret).update(`${challengeId}:${code}`).digest('hex');
}

export function otpCodeMatches(
  secret: Buffer,
  challengeId: string,
  code: string,
  storedHash: string,
): boolean {
  const expected = Buffer.from(storedHash, 'hex');
  const actual = Buffer.from(hashOtpCode(secret, challengeId, code), 'hex');
  // Lengths are equal for well-formed hashes; the guard only protects
  // timingSafeEqual from throwing on corrupted rows.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export type OtpCheck =
  { ok: true } | { ok: false; reason: 'NOT_FOUND' | 'EXPIRED' | 'LOCKED' | 'CONSUMED' };

export interface OtpChallengeState {
  expiresAt: Date;
  attempts: number;
  maxAttempts: number;
  consumedAt: Date | null;
  invalidatedAt: Date | null;
}

/** Can this challenge still accept a guess? Decided before comparing codes. */
export function checkChallenge(challenge: OtpChallengeState | null, now: Date): OtpCheck {
  if (!challenge) return { ok: false, reason: 'NOT_FOUND' };
  if (challenge.consumedAt) return { ok: false, reason: 'CONSUMED' };
  if (challenge.attempts >= challenge.maxAttempts) return { ok: false, reason: 'LOCKED' };
  if (challenge.invalidatedAt) return { ok: false, reason: 'NOT_FOUND' };
  if (challenge.expiresAt <= now) return { ok: false, reason: 'EXPIRED' };
  return { ok: true };
}
