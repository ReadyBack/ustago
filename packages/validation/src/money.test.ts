import { describe, expect, it } from 'vitest';

import {
  formatMoney,
  MAX_PRICE_MINOR,
  minorToInput,
  moneySchema,
  parseTryInput,
  priceMinorSchema,
} from './money.js';

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

describe('priceMinorSchema', () => {
  it('accepts 1.500 TL as 150000 kuruş', () => {
    expect(priceMinorSchema.parse(150000)).toBe(150000);
  });

  it('rejects floats, zero, negatives and absurd amounts', () => {
    expect(priceMinorSchema.safeParse(1500.5).success).toBe(false);
    expect(priceMinorSchema.safeParse(0).success).toBe(false);
    expect(priceMinorSchema.safeParse(-100).success).toBe(false);
    expect(priceMinorSchema.safeParse(MAX_PRICE_MINOR + 1).success).toBe(false);
  });
});

describe('parseTryInput', () => {
  it.each([
    ['1500', 150000],
    ['1.500', 150000],
    ['2.200', 220000],
    ['2.500 TL', 250000],
    ['₺1.500', 150000],
    ['1.500,50', 150050],
    ['1500,5', 150050],
    ['1500.50', 150050],
    ['1500.5', 150050],
    ['15', 1500],
    ['1.234.567', 123456700],
    [' 1 500 ', 150000],
  ])('%s → %i kuruş', (input, expected) => {
    expect(parseTryInput(input)).toBe(expected);
  });

  it.each(['', 'abc', '-5', '1,2,3', '1.50.0', '15,555', '1.5000', '12.34.5'])(
    'rejects %j',
    (input) => {
      expect(parseTryInput(input)).toBeNull();
    },
  );

  it('never turns 1500 into 15 TL or 150.000 TL', () => {
    const minor = parseTryInput('1500');
    expect(minor).toBe(150000);
    expect(formatMoney(minor ?? 0)).toBe('₺1.500');
  });
});

describe('formatMoney', () => {
  it.each([
    [150000, '₺1.500'],
    [250000, '₺2.500'],
    [220000, '₺2.200'],
    [150050, '₺1.500,50'],
    [99, '₺0,99'],
    [123456700, '₺1.234.567'],
  ])('%i → %s', (minor, expected) => {
    expect(formatMoney(minor)).toBe(expected);
    expect(formatMoney({ amountMinor: minor, currency: 'TRY' })).toBe(expected);
  });

  it('round-trips through the input helper', () => {
    for (const minor of [150000, 150050, 99, 220000]) {
      expect(parseTryInput(minorToInput(minor))).toBe(minor);
    }
  });
});
