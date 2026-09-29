import { describe, expect, it } from 'vitest';

import { moneySchema } from './money.js';

describe('moneySchema', () => {
  it('accepts integer minor units', () => {
    expect(moneySchema.parse({ amountMinor: 300000, currency: 'TRY' })).toEqual({
      amountMinor: 300000,
      currency: 'TRY',
    });
  });

  it('rejects fractional amounts', () => {
    expect(moneySchema.safeParse({ amountMinor: 3000.5, currency: 'TRY' }).success).toBe(false);
  });

  it('rejects unsupported currencies', () => {
    expect(moneySchema.safeParse({ amountMinor: 100, currency: 'USD' }).success).toBe(false);
  });
});
