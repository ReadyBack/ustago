import type { Money } from '@ustago/types';
import { z } from 'zod';

export const currencyCodeSchema = z.enum(['TRY']);

export const moneySchema = z.object({
  amountMinor: z.number().int().safe(),
  currency: currencyCodeSchema,
}) satisfies z.ZodType<Money>;

/** 1 TL: nothing on the marketplace is priced below this. */
export const MIN_PRICE_MINOR = 100;
/** 10.000.000 TL: a sanity ceiling against typos (an extra zero or three). */
export const MAX_PRICE_MINOR = 1_000_000_000;

/**
 * A price in minor units (kuruş). Integers only: 1.500 TL is 150000
 * (docs/adr/0006). Clients convert user input with `parseTryInput`.
 */
export const priceMinorSchema = z
  .number({ message: 'Tutar kuruş cinsinden tam sayı olmalı.' })
  .int('Tutar kuruş cinsinden tam sayı olmalı.')
  .min(MIN_PRICE_MINOR, 'Tutar en az 1 TL olmalı.')
  .max(MAX_PRICE_MINOR, 'Tutar çok yüksek.');

/** Labour / material parts may be zero ("malzeme yok"). */
export const pricePartMinorSchema = z
  .number()
  .int('Tutar kuruş cinsinden tam sayı olmalı.')
  .min(0)
  .max(MAX_PRICE_MINOR, 'Tutar çok yüksek.');

const THOUSANDS = /^\d{1,3}(\.\d{3})+$/;

/**
 * Parses a Turkish lira amount typed by a user into kuruş, or null when the
 * text is not a clear amount. Turkish notation uses "." for thousands and
 * "," for decimals; a lone "." with one or two digits after it (a phone
 * keypad in English) is read as the decimal point.
 *
 *   "1500" → 150000, "1.500" → 150000, "1.500,50" → 150050,
 *   "1500,5" → 150050, "1500.50" → 150050, "15" → 1500
 */
export function parseTryInput(text: string): number | null {
  const cleaned = text
    .replace(/\s/g, '')
    .replace(/^₺/, '')
    .replace(/(TL|tl|₺)$/, '');
  if (cleaned === '' || !/^[\d.,]+$/.test(cleaned)) return null;

  let whole: string;
  let fraction = '';
  if (cleaned.includes(',')) {
    const parts = cleaned.split(',');
    if (parts.length !== 2) return null;
    [whole = '', fraction = ''] = parts;
    if (whole.includes('.') && !THOUSANDS.test(whole)) return null;
    whole = whole.replace(/\./g, '');
  } else if (cleaned.includes('.')) {
    if (THOUSANDS.test(cleaned)) {
      whole = cleaned.replace(/\./g, '');
    } else {
      const parts = cleaned.split('.');
      if (parts.length !== 2) return null;
      [whole = '', fraction = ''] = parts;
    }
  } else {
    whole = cleaned;
  }
  if (!/^\d+$/.test(whole) || !/^\d{0,2}$/.test(fraction)) return null;
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0') || '0');
  return Number.isSafeInteger(minor) ? minor : null;
}

/**
 * "₺1.500" or "₺1.500,50". Formatting is done by hand so every runtime
 * (Node, Hermes, browsers) prints the same thing.
 */
export function formatMoney(money: Money | number): string {
  const minor = typeof money === 'number' ? money : money.amountMinor;
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const cents = abs % 100;
  return `${sign}₺${whole}${cents === 0 ? '' : `,${cents.toString().padStart(2, '0')}`}`;
}

/** Plain digits for an input field: 150050 → "1500,50", 150000 → "1500". */
export function minorToInput(minor: number): string {
  const cents = minor % 100;
  return `${Math.floor(minor / 100)}${cents === 0 ? '' : `,${cents.toString().padStart(2, '0')}`}`;
}
