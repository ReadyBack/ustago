import { randomBytes } from 'node:crypto';

import {
  checkChallenge,
  generateOtpCode,
  hashOtpCode,
  otpCodeMatches,
  type OtpChallengeState,
} from './otp-crypto.js';

const secret = randomBytes(32);
const now = new Date('2026-09-30T12:00:00Z');
const open: OtpChallengeState = {
  expiresAt: new Date(now.getTime() + 60_000),
  attempts: 0,
  maxAttempts: 5,
  consumedAt: null,
  invalidatedAt: null,
};

describe('generateOtpCode', () => {
  it('returns zero-padded digits of the requested length', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateOtpCode(6)).toMatch(/^\d{6}$/);
    }
    expect(generateOtpCode(4)).toMatch(/^\d{4}$/);
  });

  it('is not trivially repetitive', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateOtpCode(6)));
    expect(codes.size).toBeGreaterThan(190);
  });

  it('refuses unsafe lengths', () => {
    expect(() => generateOtpCode(3)).toThrow(RangeError);
    expect(() => generateOtpCode(9)).toThrow(RangeError);
  });
});

describe('hashOtpCode / otpCodeMatches', () => {
  it('never stores the code itself', () => {
    const hash = hashOtpCode(secret, 'challenge-1', '123456');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('123456');
  });

  it('matches only the right code for the right challenge and key', () => {
    const hash = hashOtpCode(secret, 'challenge-1', '123456');
    expect(otpCodeMatches(secret, 'challenge-1', '123456', hash)).toBe(true);
    expect(otpCodeMatches(secret, 'challenge-1', '123457', hash)).toBe(false);
    expect(otpCodeMatches(secret, 'challenge-2', '123456', hash)).toBe(false);
    expect(otpCodeMatches(randomBytes(32), 'challenge-1', '123456', hash)).toBe(false);
  });

  it('treats a corrupted stored hash as a mismatch instead of throwing', () => {
    expect(otpCodeMatches(secret, 'c', '123456', 'abc')).toBe(false);
  });
});

describe('checkChallenge', () => {
  it('accepts an open challenge', () => {
    expect(checkChallenge(open, now)).toEqual({ ok: true });
  });

  it.each([
    ['missing', null, 'NOT_FOUND'],
    ['expired', { ...open, expiresAt: now }, 'EXPIRED'],
    ['used', { ...open, consumedAt: now }, 'CONSUMED'],
    ['out of attempts', { ...open, attempts: 5 }, 'LOCKED'],
    ['replaced by a newer code', { ...open, invalidatedAt: now }, 'NOT_FOUND'],
  ] as const)('rejects a %s challenge', (_label, challenge, reason) => {
    expect(checkChallenge(challenge, now)).toEqual({ ok: false, reason });
  });
});
