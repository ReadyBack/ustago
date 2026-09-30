import { describe, expect, it } from 'vitest';

import {
  ledgerFiltersToQuery,
  listFilterQuery,
  newIdempotencyKey,
  parseAmountInput,
  parseCashFilter,
  parseFinanceRange,
  parseFinancialAction,
  parseLedgerFilters,
  parsePaymentFilters,
  parsePayoutFilter,
  paymentFiltersToApiQuery,
  paymentFiltersToQuery,
} from './finance';

const UUID = '0190a000-0000-7000-8000-00000000000a';

describe('parseAmountInput', () => {
  it.each([
    ['1.000,50', 100050],
    ['1000,5', 100050],
    ['250', 25000],
    [' 99,99 ', 9999],
    ['₺1.500', 150000],
    ['0,01', 1],
    ['1.234.567,89', 123456789],
  ])('reads %s as %i kuruş', (text, minor) => {
    expect(parseAmountInput(text)).toBe(minor);
  });

  it.each(['', '-5', '-1.000,50', '0', '0,00', 'abc', '1,234', '1.00.0', '12,5,0', '1e3'])(
    'refuses %j',
    (text) => {
      expect(parseAmountInput(text)).toBeNull();
    },
  );

  it('never goes through floats (0,29 stays 29)', () => {
    expect(parseAmountInput('0,29')).toBe(29);
    expect(parseAmountInput('1.005,10')).toBe(100510);
  });
});

describe('newIdempotencyKey', () => {
  it('is a fresh 32 character key the API accepts', () => {
    const a = newIdempotencyKey();
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,80}$/);
    expect(a).toHaveLength(32);
    expect(newIdempotencyKey()).not.toBe(a);
  });
});

describe('finance filters', () => {
  it('falls back to today for an unknown range', () => {
    expect(parseFinanceRange({ range: '7d' })).toBe('7d');
    expect(parseFinanceRange({ range: '1y' })).toBe('today');
    expect(parseFinanceRange({})).toBe('today');
  });

  it('keeps valid payment filters and drops the rest', () => {
    expect(
      parsePaymentFilters({
        status: 'SUCCEEDED',
        method: 'BITCOIN',
        from: '2026-09-01',
        to: '31.09.2026',
        cursor: ['a', 'b'],
      }),
    ).toEqual({
      status: 'SUCCEEDED',
      method: undefined,
      from: '2026-09-01',
      to: undefined,
      cursor: undefined,
    });
  });

  it('sends days as typed with cursor and page size', () => {
    const api = new URLSearchParams(
      paymentFiltersToApiQuery({
        status: 'REFUNDED',
        method: 'IN_APP',
        from: '2026-09-01',
        to: '2026-09-30',
        cursor: UUID,
      }),
    );
    expect(Object.fromEntries(api)).toEqual({
      status: 'REFUNDED',
      method: 'IN_APP',
      from: '2026-09-01',
      to: '2026-09-30',
      cursor: UUID,
      limit: '25',
    });
    expect(paymentFiltersToQuery({ method: 'CASH', cursor: UUID })).toBe('method=CASH');
    expect(paymentFiltersToQuery({ method: 'CASH' }, { cursor: UUID })).toBe(
      `method=CASH&cursor=${UUID}`,
    );
  });

  it('builds ledger queries, keeping payment / provider scopes', () => {
    const filters = parseLedgerFilters({
      type: 'REFUND_COMPLETED',
      paymentId: UUID,
      providerId: 'x',
      cursor: UUID,
    });
    expect(filters).toEqual({
      type: 'REFUND_COMPLETED',
      paymentId: UUID,
      providerId: undefined,
      cursor: UUID,
    });
    expect(ledgerFiltersToQuery(filters)).toBe(`type=REFUND_COMPLETED&paymentId=${UUID}`);
    expect(ledgerFiltersToQuery(filters, {}, { api: true })).toBe(
      `type=REFUND_COMPLETED&paymentId=${UUID}&cursor=${UUID}&limit=25`,
    );
    expect(parseLedgerFilters({ type: 'THEFT' }).type).toBeUndefined();
  });

  it('builds single-select list queries for payouts and cash', () => {
    const payouts = parsePayoutFilter({ status: 'REQUESTED', cursor: UUID });
    expect(listFilterQuery('status', payouts)).toBe(`status=REQUESTED&cursor=${UUID}`);
    expect(listFilterQuery('status', payouts, { cursor: null, api: true })).toBe(
      'status=REQUESTED&limit=25',
    );
    const cash = parseCashFilter({ status: 'PAID' });
    expect(cash.value).toBeUndefined();
    expect(listFilterQuery('status', cash, { cursor: UUID })).toBe(`cursor=${UUID}`);
  });
});

describe('parseFinancialAction', () => {
  it('sends nothing when no action is chosen', () => {
    expect(parseFinancialAction('', '')).toEqual({ ok: true, value: undefined });
  });

  it('reads a partial refund amount in kuruş', () => {
    expect(parseFinancialAction('PARTIAL_CUSTOMER_REFUND', '1.000,50')).toEqual({
      ok: true,
      value: { type: 'PARTIAL_CUSTOMER_REFUND', refundAmountMinor: 100050 },
    });
  });

  it('needs a valid amount for a partial refund', () => {
    for (const amount of ['', '-10', '0', 'yüz']) {
      const result = parseFinancialAction('PARTIAL_CUSTOMER_REFUND', amount);
      expect(result.ok).toBe(false);
    }
  });

  it('passes other actions without an amount and refuses a stray amount', () => {
    expect(parseFinancialAction('FULL_CUSTOMER_REFUND', '')).toEqual({
      ok: true,
      value: { type: 'FULL_CUSTOMER_REFUND' },
    });
    expect(parseFinancialAction('RELEASE_PROVIDER_FUNDS', '  ')).toEqual({
      ok: true,
      value: { type: 'RELEASE_PROVIDER_FUNDS' },
    });
    expect(parseFinancialAction('FULL_CUSTOMER_REFUND', '100').ok).toBe(false);
    expect(parseFinancialAction('', '100').ok).toBe(false);
  });

  it('refuses unknown action types', () => {
    expect(parseFinancialAction('KEEP_THE_MONEY', '').ok).toBe(false);
  });
});
