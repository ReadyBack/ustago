import { describe, expect, it } from 'vitest';

import { maskPhone, normalizePhone, phoneSchema } from './phone.js';

describe('normalizePhone', () => {
  it.each([
    '0532 123 45 67',
    '5321234567',
    '+90 532 123 45 67',
    '+905321234567',
    '905321234567',
    '00905321234567',
    '(0532) 123-45-67',
    '  0532.123.45.67  ',
  ])('normalises %s to E.164', (input) => {
    expect(normalizePhone(input)).toBe('+905321234567');
  });

  it.each([
    ['landline', '0212 123 45 67'],
    ['too short', '0532 123 45'],
    ['too long', '0532 123 45 678'],
    ['letters', '0532abc4567'],
    ['empty', ''],
    ['unsupported country (Germany)', '+49 1512 3456789'],
    ['unsupported country (US)', '+1 202 555 0147'],
    ['absurdly long input', '5'.repeat(40)],
  ])('rejects %s', (_label, input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe('phoneSchema', () => {
  it('outputs E.164', () => {
    expect(phoneSchema.parse('0 (532) 123 45 67')).toBe('+905321234567');
  });

  it('gives a Turkish error message', () => {
    const result = phoneSchema.safeParse('123');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('cep telefonu');
  });
});

describe('maskPhone', () => {
  it('keeps only the country/operator prefix and last two digits', () => {
    expect(maskPhone('+905321234567')).toBe('+90532*****67');
  });
});
