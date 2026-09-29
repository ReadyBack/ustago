import { describe, expect, it } from 'vitest';

import { otpRequestSchema, otpVerifySchema } from './otp.js';

describe('otpRequestSchema', () => {
  it('defaults to REGISTER_OR_LOGIN and normalises the phone', () => {
    expect(otpRequestSchema.parse({ phone: '0532 123 45 67' })).toEqual({
      phone: '+905321234567',
      purpose: 'REGISTER_OR_LOGIN',
    });
  });

  it('rejects unknown purposes and extra fields', () => {
    expect(otpRequestSchema.safeParse({ phone: '05321234567', purpose: 'X' }).success).toBe(false);
    expect(otpRequestSchema.safeParse({ phone: '05321234567', code: '1' }).success).toBe(false);
  });
});

describe('otpVerifySchema', () => {
  it('accepts a numeric code', () => {
    expect(otpVerifySchema.parse({ phone: '05321234567', code: ' 123456 ' }).code).toBe('123456');
  });

  it.each(['12a456', '', '123', '123456789'])('rejects code %j', (code) => {
    expect(otpVerifySchema.safeParse({ phone: '05321234567', code }).success).toBe(false);
  });
});
