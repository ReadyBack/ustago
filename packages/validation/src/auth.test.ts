import { describe, expect, it } from 'vitest';

import { loginRequestSchema, registerRequestSchema } from './auth.js';
import { turkishMobilePhoneSchema } from './common.js';

const validRegister = {
  email: '  Ayse@Example.COM ',
  password: 'uzun-bir-sifre-123',
  firstName: 'Ayşe',
  lastName: 'Yılmaz',
};

describe('registerRequestSchema', () => {
  it('normalises the e-mail and defaults to a customer account', () => {
    const parsed = registerRequestSchema.parse(validRegister);
    expect(parsed.email).toBe('ayse@example.com');
    expect(parsed.accountType).toBe('CUSTOMER');
  });

  it('rejects short passwords', () => {
    expect(registerRequestSchema.safeParse({ ...validRegister, password: 'kisa' }).success).toBe(
      false,
    );
  });

  it('rejects a password equal to the e-mail', () => {
    const result = registerRequestSchema.safeParse({
      ...validRegister,
      email: 'ayse.yilmaz@example.com',
      password: 'Ayse.Yilmaz@example.com',
    });
    expect(result.success).toBe(false);
  });

  it('never allows staff roles through public sign-up', () => {
    expect(
      registerRequestSchema.safeParse({ ...validRegister, accountType: 'ADMIN' }).success,
    ).toBe(false);
  });

  it('rejects unknown fields such as roles', () => {
    expect(registerRequestSchema.safeParse({ ...validRegister, roles: ['ADMIN'] }).success).toBe(
      false,
    );
  });
});

describe('loginRequestSchema', () => {
  it('accepts any non-empty password so the policy is not revealed', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
  });
});

describe('turkishMobilePhoneSchema', () => {
  it.each(['05321234567', '5321234567', '+90 532 123 45 67', '+905321234567'])(
    'normalises %s to E.164',
    (input) => {
      expect(turkishMobilePhoneSchema.parse(input)).toBe('+905321234567');
    },
  );

  it('rejects landlines and foreign numbers', () => {
    expect(turkishMobilePhoneSchema.safeParse('02121234567').success).toBe(false);
    expect(turkishMobilePhoneSchema.safeParse('+14155550100').success).toBe(false);
  });
});
