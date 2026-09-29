import { type CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js/min';
import { z } from 'zod';

/**
 * Countries whose numbers the platform accepts for sign-in and SMS. Kept
 * short on purpose: every extra country is SMS cost and "SMS pumping" fraud
 * exposure. Adding a country is a one-line change here (docs/adr/0009).
 */
export const SUPPORTED_PHONE_COUNTRIES = ['TR'] as const satisfies readonly CountryCode[];
export type SupportedPhoneCountry = (typeof SUPPORTED_PHONE_COUNTRIES)[number];

/** Country-specific rules on top of libphonenumber's validity check. */
const MOBILE_RULES: Record<SupportedPhoneCountry, RegExp> = {
  // Turkish mobile (GSM) numbers are 5XX XXX XX XX.
  TR: /^5\d{9}$/,
};

/**
 * Normalises a phone number to E.164, or returns null when it is not a
 * valid mobile number of a supported country. Accepts common Turkish
 * spellings: "0532 123 45 67", "5321234567", "+90 532 123 45 67",
 * "90 532 123 45 67", "(0532) 123-45-67".
 */
export function normalizePhone(
  input: string,
  defaultCountry: SupportedPhoneCountry = 'TR',
): string | null {
  let value = input.trim();
  if (value.length === 0 || value.length > 32) return null;
  // "905321234567" without the plus is a common way to type +90.
  const digits = value.replace(/[\s().-]/g, '');
  if (/^90\d{10}$/.test(digits)) value = `+${digits}`;
  if (/^00\d+$/.test(digits)) value = `+${digits.slice(2)}`;

  const parsed = parsePhoneNumberFromString(value, defaultCountry);
  if (!parsed?.isValid() || !parsed.country) return null;
  const country = parsed.country as string;
  if (!isSupportedCountry(country)) return null;
  if (!MOBILE_RULES[country].test(parsed.nationalNumber)) return null;
  return parsed.number;
}

function isSupportedCountry(country: string): country is SupportedPhoneCountry {
  return (SUPPORTED_PHONE_COUNTRIES as readonly string[]).includes(country);
}

/** Masks a number for logs and audit records: +90532*****67. */
export function maskPhone(e164: string): string {
  if (e164.length <= 7) return '*'.repeat(e164.length);
  return `${e164.slice(0, 6)}${'*'.repeat(e164.length - 8)}${e164.slice(-2)}`;
}

/** Mobile number of a supported country, output in E.164 (+905321234567). */
export const phoneSchema = z
  .string()
  .max(32)
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Geçerli bir cep telefonu numarası girin.' });
      return z.NEVER;
    }
    return normalized;
  });
