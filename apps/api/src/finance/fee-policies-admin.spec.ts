import type { PlatformFeePolicy } from '../generated/prisma/client.js';
import { lifecycleOf, previewLines } from './fee-policies-admin.service.js';

const row = (over: Partial<PlatformFeePolicy>): PlatformFeePolicy =>
  ({
    id: 'p',
    code: 'c',
    bps: 1500,
    fixedFeeMinor: 0n,
    minFeeMinor: null,
    maxFeeMinor: null,
    currency: 'TRY',
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    isDevelopment: false,
    note: null,
    createdById: null,
    createdAt: new Date('2025-12-01T00:00:00Z'),
    name: 'n',
    publishedAt: new Date('2025-12-02T00:00:00Z'),
    publishedById: null,
    retiredAt: null,
    retiredById: null,
    ...over,
  }) as PlatformFeePolicy;

describe('fee policy lifecycle (docs/adr/0025)', () => {
  const now = new Date('2026-06-01T00:00:00Z');

  it('derives DRAFT / SCHEDULED / ACTIVE / RETIRED', () => {
    expect(lifecycleOf(row({ publishedAt: null }), now, null)).toBe('DRAFT');
    expect(lifecycleOf(row({ effectiveFrom: new Date('2027-01-01') }), now, null)).toBe(
      'SCHEDULED',
    );
    expect(lifecycleOf(row({ id: 'a' }), now, 'a')).toBe('ACTIVE');
    // Superseded by a later published policy.
    expect(lifecycleOf(row({ id: 'old' }), now, 'a')).toBe('RETIRED');
    expect(lifecycleOf(row({ retiredAt: now }), now, null)).toBe('RETIRED');
  });

  it('previews %15 exactly at the five standard amounts (no floating point)', () => {
    const lines = previewLines({
      bps: 1500,
      fixedFeeMinor: 0n,
      minFeeMinor: null,
      maxFeeMinor: null,
    });
    expect(
      lines.map((l) => [l.gross.amountMinor, l.fee.amountMinor, l.providerNet.amountMinor]),
    ).toEqual([
      [50000, 7500, 42500],
      [100000, 15000, 85000],
      [250000, 37500, 212500],
      [500000, 75000, 425000],
      [1000000, 150000, 850000],
    ]);
  });

  it('applies fixed, minimum and maximum fees', () => {
    const lines = previewLines({
      bps: 1000,
      fixedFeeMinor: 500n,
      minFeeMinor: 6000n,
      maxFeeMinor: 60000n,
    });
    expect(lines.map((l) => l.fee.amountMinor)).toEqual([6000, 10500, 25500, 50500, 60000]);
  });
});
