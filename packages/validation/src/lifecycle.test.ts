import { describe, expect, it } from 'vitest';

import { createPenaltySchema, resolveDisputeSchema } from './admin-lifecycle.js';
import {
  cancelJobSchema,
  createChangeOrderSchema,
  createReviewSchema,
  maskPersonName,
  openDisputeSchema,
  updateReviewSchema,
} from './lifecycle.js';

describe('change order input', () => {
  it('accepts a positive kuruş amount with a reason', () => {
    const r = createChangeOrderSchema.parse({
      amountMinor: 50000,
      description: 'Kompresör rölesi değişti, parça bedeli.',
    });
    expect(r.amountMinor).toBe(50000);
  });

  it.each([0, -100, 12.5, '500'])('refuses amount %s', (amountMinor) => {
    expect(
      createChangeOrderSchema.safeParse({ amountMinor, description: 'Ek parça gerekti burada.' })
        .success,
    ).toBe(false);
  });

  it('requires a real description and no HTML', () => {
    expect(
      createChangeOrderSchema.safeParse({ amountMinor: 100, description: 'kısa' }).success,
    ).toBe(false);
    expect(
      createChangeOrderSchema.safeParse({
        amountMinor: 100,
        description: '<b>Ek parça</b> takıldı ve test edildi',
      }).success,
    ).toBe(false);
  });
});

describe('review input', () => {
  it('requires an overall 1-5 rating; details and comment are optional', () => {
    expect(createReviewSchema.parse({ rating: 5 })).toEqual({ rating: 5 });
    for (const rating of [0, 6, 4.5, null]) {
      expect(createReviewSchema.safeParse({ rating }).success).toBe(false);
    }
    expect(createReviewSchema.safeParse({ rating: 4, qualityRating: 7 }).success).toBe(false);
  });

  it('cleans the comment: trims, removes control characters, empty becomes null', () => {
    expect(createReviewSchema.parse({ rating: 4, comment: '  İyi iş\u0007  ' }).comment).toBe(
      'İyi iş',
    );
    expect(createReviewSchema.parse({ rating: 4, comment: '   ' }).comment).toBeNull();
  });

  it('limits the comment to 1000 characters and plain text', () => {
    expect(createReviewSchema.safeParse({ rating: 4, comment: 'a'.repeat(1001) }).success).toBe(
      false,
    );
    expect(
      createReviewSchema.safeParse({ rating: 4, comment: '<script>alert(1)</script>' }).success,
    ).toBe(false);
  });

  it('refuses unknown fields and empty edits', () => {
    expect(createReviewSchema.safeParse({ rating: 5, jobId: 'x' }).success).toBe(false);
    expect(updateReviewSchema.safeParse({}).success).toBe(false);
    expect(updateReviewSchema.parse({ comment: 'Güncel yorum' })).toEqual({
      comment: 'Güncel yorum',
    });
  });
});

describe('job actions input', () => {
  it('needs a reason category and a description to report a problem', () => {
    expect(
      openDisputeSchema.safeParse({ reason: 'POOR_QUALITY', description: 'Klima hâlâ soğutmuyor.' })
        .success,
    ).toBe(true);
    expect(openDisputeSchema.safeParse({ reason: 'POOR_QUALITY', description: '' }).success).toBe(
      false,
    );
    expect(
      openDisputeSchema.safeParse({ reason: 'BAD', description: 'x'.repeat(20) }).success,
    ).toBe(false);
  });

  it('needs a cancellation reason', () => {
    expect(cancelJobSchema.safeParse({ reason: '' }).success).toBe(false);
    expect(cancelJobSchema.parse({ reason: 'Planım değişti' }).reason).toBe('Planım değişti');
  });
});

describe('admin input', () => {
  it('requires a note to resolve a dispute', () => {
    expect(
      resolveDisputeSchema.safeParse({ outcome: 'RESOLVED_FOR_PROVIDER', note: '' }).success,
    ).toBe(false);
  });

  it('never creates account-level sanctions through the penalty endpoint', () => {
    const base = { reasonCode: 'NO_SHOW', reason: 'Müşteri iki kez usta gelmedi bildirdi.' };
    expect(createPenaltySchema.safeParse({ ...base, type: 'WARNING' }).success).toBe(true);
    expect(createPenaltySchema.safeParse({ ...base, type: 'PERMANENT_BAN' }).success).toBe(false);
    expect(
      createPenaltySchema.safeParse({ ...base, type: 'WARNING', reasonCode: 'no show' }).success,
    ).toBe(false);
  });
});

describe('maskPersonName', () => {
  it('shows first name and last initial only', () => {
    expect(maskPersonName('Ayşe', 'Kaya')).toBe('Ayşe K.');
    expect(maskPersonName('Ayşe Nur', 'ışık')).toBe('Ayşe I.');
    expect(maskPersonName('', 'Kaya')).toBe('UstaGO kullanıcısı');
  });
});
