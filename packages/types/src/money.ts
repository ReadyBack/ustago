export type CurrencyCode = 'TRY';

/**
 * Money is always stored in minor units (kuruş for TRY) as an integer.
 * 3.000,00 TL = { amountMinor: 300000, currency: 'TRY' }.
 */
export interface Money {
  amountMinor: number;
  currency: CurrencyCode;
}
