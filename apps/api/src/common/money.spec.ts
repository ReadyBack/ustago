import { describe, expect, it } from 'vitest';

import { toMinor, toMoney, toMoneyOrNull } from './money.js';

describe('money boundary', () => {
  it('converts BIGINT kuruş to API money without loss', () => {
    expect(toMoney(220000n, 'TRY')).toEqual({ amountMinor: 220000, currency: 'TRY' });
    expect(toMoneyOrNull(null, 'TRY')).toBeNull();
  });

  it('refuses amounts beyond the safe integer range instead of rounding', () => {
    expect(() => toMoney(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 'TRY')).toThrow(RangeError);
  });

  it('only accepts integers on the way in', () => {
    expect(toMinor(150000)).toBe(150000n);
    expect(() => toMinor(1500.5)).toThrow(RangeError);
  });
});
