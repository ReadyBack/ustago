import { describe, expect, it } from 'vitest';

import {
  adminStatsQuerySchema,
  counterQuoteSchema,
  createQuoteSchema,
  createServiceRequestSchema,
  updateServiceRequestSchema,
} from './marketplace.js';

const base = {
  type: 'QUOTE',
  categoryId: '0192f4c1-0000-7000-8000-000000000001',
  addressId: '0192f4c1-0000-7000-8000-000000000002',
  title: 'Klima montajı',
  description: 'Salon için 12000 BTU split klima montajı yapılacak.',
} as const;

describe('createServiceRequestSchema', () => {
  it('accepts "Bütçem belli değil" as a null budget', () => {
    const parsed = createServiceRequestSchema.parse({ ...base, budgetMinor: null });
    expect(parsed.budgetMinor).toBeNull();
    expect(parsed.publish).toBe(true);
    expect(parsed.photoUploadIds).toEqual([]);
  });

  it('keeps a 1.500 TL budget as 150000 kuruş', () => {
    expect(createServiceRequestSchema.parse({ ...base, budgetMinor: 150000 }).budgetMinor).toBe(
      150000,
    );
  });

  it('rejects a fractional budget, a missing budget field and unknown fields', () => {
    expect(createServiceRequestSchema.safeParse({ ...base, budgetMinor: 1500.5 }).success).toBe(
      false,
    );
    expect(createServiceRequestSchema.safeParse(base).success).toBe(false);
    expect(
      createServiceRequestSchema.safeParse({ ...base, budgetMinor: null, status: 'MATCHED' })
        .success,
    ).toBe(false);
  });

  it('rejects a preferred window that ends before it starts', () => {
    const result = createServiceRequestSchema.safeParse({
      ...base,
      budgetMinor: null,
      preferredStartAt: '2026-10-02T10:00:00.000Z',
      preferredEndAt: '2026-10-01T10:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects duplicate photo ids and more than five photos', () => {
    const id = '0192f4c1-0000-7000-8000-000000000003';
    expect(
      createServiceRequestSchema.safeParse({ ...base, budgetMinor: null, photoUploadIds: [id, id] })
        .success,
    ).toBe(false);
    const six = Array.from({ length: 6 }, (_, i) => `0192f4c1-0000-7000-8000-00000000001${i}`);
    expect(
      createServiceRequestSchema.safeParse({ ...base, budgetMinor: null, photoUploadIds: six })
        .success,
    ).toBe(false);
  });
});

describe('updateServiceRequestSchema', () => {
  it('needs at least one field and never accepts a status', () => {
    expect(updateServiceRequestSchema.safeParse({}).success).toBe(false);
    expect(updateServiceRequestSchema.safeParse({ status: 'MATCHED' }).success).toBe(false);
    expect(updateServiceRequestSchema.safeParse({ budgetMinor: null }).success).toBe(true);
  });
});

describe('createQuoteSchema', () => {
  it('accepts a quote above the customer budget (budget is not a ceiling)', () => {
    expect(createQuoteSchema.safeParse({ totalMinor: 250000 }).success).toBe(true);
  });

  it('requires labour + material to equal the total when both are given', () => {
    expect(
      createQuoteSchema.safeParse({ totalMinor: 250000, laborMinor: 100000, materialMinor: 150000 })
        .success,
    ).toBe(true);
    expect(
      createQuoteSchema.safeParse({ totalMinor: 250000, laborMinor: 100000, materialMinor: 100000 })
        .success,
    ).toBe(false);
    expect(createQuoteSchema.safeParse({ totalMinor: 250000, laborMinor: 100000 }).success).toBe(
      true,
    );
  });

  it('accepts labour + material + servis/diğer lines that add up to the total', () => {
    const lines = { laborMinor: 100000, materialMinor: 120000, serviceMinor: 20000 };
    expect(
      createQuoteSchema.safeParse({ totalMinor: 250000, ...lines, otherMinor: 10000 }).success,
    ).toBe(true);
    expect(createQuoteSchema.safeParse({ totalMinor: 250000, ...lines }).success).toBe(false);
  });

  it('rejects zero, negative and fractional totals', () => {
    for (const totalMinor of [0, -100, 2500.5]) {
      expect(createQuoteSchema.safeParse({ totalMinor }).success).toBe(false);
    }
  });
});

describe('counterQuoteSchema', () => {
  it('needs the revision the caller answers', () => {
    expect(counterQuoteSchema.safeParse({ totalMinor: 200000 }).success).toBe(false);
    expect(
      counterQuoteSchema.safeParse({ totalMinor: 200000, expectedRevisionNo: 1 }).success,
    ).toBe(true);
  });
});

describe('adminStatsQuerySchema', () => {
  it('accepts IANA zones and rejects garbage', () => {
    expect(adminStatsQuerySchema.safeParse({ tz: 'Europe/Istanbul' }).success).toBe(true);
    expect(adminStatsQuerySchema.safeParse({ tz: 'UTC' }).success).toBe(true);
    expect(adminStatsQuerySchema.safeParse({ tz: "'; DROP TABLE" }).success).toBe(false);
  });
});
