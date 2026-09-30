import type {
  CashSettlementStatus,
  LedgerTransactionType,
  PaymentMethodChoice,
  PaymentStatus,
  PayoutStatus,
} from '@ustago/types';
import {
  cashSettlementStatusSchema,
  disputeFinancialActionSchema,
  financeRangeSchema,
  ledgerTransactionTypeSchema,
  parseTryInput,
  paymentMethodChoiceSchema,
  paymentStatusSchema,
  payoutStatusSchema,
  uuidSchema,
  type DisputeFinancialAction,
} from '@ustago/validation';
import { z } from 'zod';

type SearchParams = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) =>
  typeof value === 'string' && value !== '' ? value : undefined;
const daySchema = z.iso.date();

function pick<T>(schema: z.ZodType<T>, raw: string | undefined): T | undefined {
  if (raw === undefined) return undefined;
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

// ---------------------------------------------------------------------------
// Money input
// ---------------------------------------------------------------------------

/**
 * A TL amount typed by an admin ("1.000,50", "250", "99,9") as positive
 * kuruş, or null. Parsed as text, never through a float; negative, zero and
 * malformed amounts are refused.
 */
export function parseAmountInput(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.startsWith('-')) return null;
  const minor = parseTryInput(trimmed);
  return minor !== null && minor > 0 ? minor : null;
}

/** Shown when the refundable amount moved since the confirm screen was rendered. */
export const REFUND_STALE_MESSAGE = 'Tutar değişti, sayfayı yenileyip tekrar kontrol edin.';

/** A fresh `Idempotency-Key`: a UUID without dashes (32 hex characters). */
export function newIdempotencyKey(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

// ---------------------------------------------------------------------------
// Summary range
// ---------------------------------------------------------------------------

export type FinanceRange = z.infer<typeof financeRangeSchema>;

export const FINANCE_RANGE_LABELS: Record<FinanceRange, string> = {
  today: 'Bugün',
  '7d': '7 gün',
  '30d': '30 gün',
};

export function parseFinanceRange(params: SearchParams): FinanceRange {
  return pick(financeRangeSchema, one(params['range'])) ?? 'today';
}

// ---------------------------------------------------------------------------
// Payments list
// ---------------------------------------------------------------------------

export interface PaymentFilters {
  status?: PaymentStatus;
  method?: PaymentMethodChoice;
  /** yyyy-mm-dd; the API reads it as an Istanbul calendar day. */
  from?: string;
  to?: string;
  cursor?: string;
}

/** Invalid values are dropped (the page shows everything), never sent to the API. */
export function parsePaymentFilters(params: SearchParams): PaymentFilters {
  return {
    status: pick(paymentStatusSchema, one(params['status'])),
    method: pick(paymentMethodChoiceSchema, one(params['method'])),
    from: pick(daySchema, one(params['from'])),
    to: pick(daySchema, one(params['to'])),
    cursor: pick(uuidSchema, one(params['cursor'])),
  };
}

/** The page's own query string (without the cursor unless given in `extra`). */
export function paymentFiltersToQuery(
  filters: PaymentFilters,
  extra: Record<string, string> = {},
): string {
  const query = new URLSearchParams();
  for (const key of ['status', 'method', 'from', 'to'] as const) {
    const value = filters[key];
    if (value) query.set(key, value);
  }
  for (const [key, value] of Object.entries(extra)) query.set(key, value);
  return query.toString();
}

/** The API query: days are sent as typed (YYYY-MM-DD), 25 rows a page. */
export function paymentFiltersToApiQuery(filters: PaymentFilters): string {
  const query = new URLSearchParams(paymentFiltersToQuery(filters));
  if (filters.cursor) query.set('cursor', filters.cursor);
  query.set('limit', '25');
  return query.toString();
}

// ---------------------------------------------------------------------------
// Single-select lists (ledger type, payout status, cash status)
// ---------------------------------------------------------------------------

export interface ListFilter<T extends string> {
  value?: T;
  cursor?: string;
}

function parseListFilter<T extends string>(
  schema: z.ZodType<T>,
  key: string,
  params: SearchParams,
): ListFilter<T> {
  return { value: pick(schema, one(params[key])), cursor: pick(uuidSchema, one(params['cursor'])) };
}

export const parsePayoutFilter = (params: SearchParams): ListFilter<PayoutStatus> =>
  parseListFilter(payoutStatusSchema, 'status', params);
export const parseCashFilter = (params: SearchParams): ListFilter<CashSettlementStatus> =>
  parseListFilter(cashSettlementStatusSchema, 'status', params);

/**
 * Query string for a single-select list. `cursor` overrides the filter's
 * own cursor (null drops it); `api` adds the page size.
 */
export function listFilterQuery<T extends string>(
  key: string,
  filter: ListFilter<T>,
  options: { cursor?: string | null; api?: boolean } = {},
): string {
  const query = new URLSearchParams();
  if (filter.value) query.set(key, filter.value);
  const cursor = options.cursor === undefined ? filter.cursor : options.cursor;
  if (cursor) query.set('cursor', cursor);
  if (options.api) query.set('limit', '25');
  return query.toString();
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export interface LedgerFilters {
  type?: LedgerTransactionType;
  paymentId?: string;
  providerId?: string;
  cursor?: string;
}

export function parseLedgerFilters(params: SearchParams): LedgerFilters {
  return {
    type: pick(ledgerTransactionTypeSchema, one(params['type'])),
    paymentId: pick(uuidSchema, one(params['paymentId'])),
    providerId: pick(uuidSchema, one(params['providerId'])),
    cursor: pick(uuidSchema, one(params['cursor'])),
  };
}

/** Page query (no cursor unless given in `extra`); `api` adds the cursor and page size. */
export function ledgerFiltersToQuery(
  filters: LedgerFilters,
  extra: Record<string, string> = {},
  options: { api?: boolean } = {},
): string {
  const query = new URLSearchParams();
  for (const key of ['type', 'paymentId', 'providerId'] as const) {
    const value = filters[key];
    if (value) query.set(key, value);
  }
  if (options.api) {
    if (filters.cursor) query.set('cursor', filters.cursor);
    query.set('limit', '25');
  }
  for (const [key, value] of Object.entries(extra)) query.set(key, value);
  return query.toString();
}

// ---------------------------------------------------------------------------
// Dispute resolution: what happens to the money
// ---------------------------------------------------------------------------

export type FinancialActionResult =
  { ok: true; value: DisputeFinancialAction | undefined } | { ok: false; error: string };

/**
 * Reads the dispute form's financial choice. No choice means "not sent"
 * (the API asks for one when money is held). The TL amount is only read for
 * a partial refund; typing one for any other choice is refused so nobody
 * believes a partial amount was applied.
 */
export function parseFinancialAction(type: string, amountText: string): FinancialActionResult {
  if (type === '') {
    return amountText.trim() === ''
      ? { ok: true, value: undefined }
      : { ok: false, error: 'Kısmi iade tutarı için “Müşteriye kısmi iade” seçin.' };
  }
  let refundAmountMinor: number | undefined;
  if (type === 'PARTIAL_CUSTOMER_REFUND') {
    const minor = parseAmountInput(amountText);
    if (minor === null) {
      return {
        ok: false,
        error: 'Kısmi iade için geçerli bir tutar girin (ör. 250 veya 1.000,50).',
      };
    }
    refundAmountMinor = minor;
  } else if (amountText.trim() !== '') {
    return { ok: false, error: 'Tutar yalnızca “Müşteriye kısmi iade” seçildiğinde girilir.' };
  }
  const parsed = disputeFinancialActionSchema.safeParse({
    type,
    ...(refundAmountMinor === undefined ? {} : { refundAmountMinor }),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Geçersiz finansal işlem.' };
  }
  return { ok: true, value: parsed.data };
}
