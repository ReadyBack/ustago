import { describe, expect, it } from 'vitest';

import {
  adminRefundSchema,
  disputeFinancialActionSchema,
  formatBps,
  idempotencyKeySchema,
  isValidTrIban,
  maskIban,
  normalizeIban,
  payoutDestinationRequestSchema,
  payoutRequestSchema,
} from './finance.js';

const IBAN = 'TR33 0006 1005 1978 6457 8413 26';

describe('finance validation', () => {
  it('validates Turkish IBANs with the mod-97 checksum', () => {
    expect(isValidTrIban(IBAN)).toBe(true);
    expect(isValidTrIban('TR330006100519786457841327')).toBe(false);
    expect(isValidTrIban('DE89370400440532013000')).toBe(false);
    expect(normalizeIban(' tr33 0006 ')).toBe('TR330006');
  });

  it('masks everything but the last four digits', () => {
    const masked = maskIban(IBAN);
    expect(masked).toBe('TR** **** **** **** **** **13 26');
    expect(masked).not.toContain('0006100519786457');
  });

  it('destination requests normalise the IBAN and reject bad ones', () => {
    expect(payoutDestinationRequestSchema.parse({ holderName: 'Test Usta', iban: IBAN }).iban).toBe(
      'TR330006100519786457841326',
    );
    expect(
      payoutDestinationRequestSchema.safeParse({ holderName: 'Test Usta', iban: 'TR00' }).success,
    ).toBe(false);
  });

  it('amounts are positive integer kuruş, never floats', () => {
    expect(payoutRequestSchema.safeParse({ amountMinor: 100000 }).success).toBe(true);
    expect(payoutRequestSchema.safeParse({ amountMinor: 1000.5 }).success).toBe(false);
    expect(payoutRequestSchema.safeParse({ amountMinor: 0 }).success).toBe(false);
    expect(payoutRequestSchema.safeParse({ amountMinor: -5 }).success).toBe(false);
    expect(payoutRequestSchema.safeParse({ amountMinor: '100' }).success).toBe(false);
  });

  it('idempotency keys are 8-80 safe characters', () => {
    expect(idempotencyKeySchema.safeParse('abcDEF12_-').success).toBe(true);
    expect(idempotencyKeySchema.safeParse('short').success).toBe(false);
    expect(idempotencyKeySchema.safeParse('has space in it').success).toBe(false);
    expect(idempotencyKeySchema.safeParse('x'.repeat(81)).success).toBe(false);
  });

  it('admin refunds need a reason, a note and the refundable amount seen on screen', () => {
    expect(
      adminRefundSchema.safeParse({
        amountMinor: 50000,
        reason: 'SERVICE_ISSUE',
        note: 'Müşteri memnun kalmadı.',
        expectedRefundableMinor: 220000,
      }).success,
    ).toBe(true);
    expect(
      adminRefundSchema.safeParse({
        amountMinor: 50000,
        reason: 'SERVICE_ISSUE',
        note: '',
        expectedRefundableMinor: 1,
      }).success,
    ).toBe(false);
    // System-only reasons cannot be picked by hand.
    expect(
      adminRefundSchema.safeParse({
        amountMinor: 1,
        reason: 'JOB_CANCELLED',
        note: 'deneme',
        expectedRefundableMinor: 1,
      }).success,
    ).toBe(false);
  });

  it('partial dispute refunds carry an amount, the others do not', () => {
    expect(
      disputeFinancialActionSchema.safeParse({ type: 'PARTIAL_CUSTOMER_REFUND' }).success,
    ).toBe(false);
    expect(
      disputeFinancialActionSchema.safeParse({
        type: 'PARTIAL_CUSTOMER_REFUND',
        refundAmountMinor: 100,
      }).success,
    ).toBe(true);
    expect(
      disputeFinancialActionSchema.safeParse({
        type: 'FULL_CUSTOMER_REFUND',
        refundAmountMinor: 100,
      }).success,
    ).toBe(false);
  });

  it('formats basis points', () => {
    expect(formatBps(1500)).toBe('%15');
  });
});
