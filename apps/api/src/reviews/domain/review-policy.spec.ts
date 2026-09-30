import { editableUntil, isEditable, reviewEligibility, toProviderRating } from './review-policy.js';

describe('review policy', () => {
  it('lets only the customer of a completed job review', () => {
    expect(reviewEligibility({ status: 'COMPLETED', customerUserId: 'c' }, 'c')).toEqual({
      ok: true,
    });
    expect(reviewEligibility({ status: 'COMPLETED', customerUserId: 'c' }, 'p')).toEqual({
      ok: false,
      reason: 'NOT_CUSTOMER',
    });
    for (const status of [
      'IN_PROGRESS',
      'AWAITING_COMPLETION_CONFIRMATION',
      'CANCELLED',
      'DISPUTED',
    ] as const) {
      expect(reviewEligibility({ status, customerUserId: 'c' }, 'c')).toEqual({
        ok: false,
        reason: 'JOB_NOT_COMPLETED',
      });
    }
  });

  it('keeps a published review editable for 30 days', () => {
    const created = new Date('2026-09-01T12:00:00Z');
    expect(editableUntil(created).toISOString()).toBe('2026-10-01T12:00:00.000Z');
    expect(
      isEditable({ createdAt: created, status: 'PUBLISHED' }, new Date('2026-09-30T00:00:00Z')),
    ).toBe(true);
    expect(
      isEditable({ createdAt: created, status: 'PUBLISHED' }, new Date('2026-10-02T00:00:00Z')),
    ).toBe(false);
    expect(
      isEditable({ createdAt: created, status: 'HIDDEN' }, new Date('2026-09-02T00:00:00Z')),
    ).toBe(false);
  });

  it('shows no invented rating: null without reviews, one decimal otherwise', () => {
    expect(toProviderRating(0, null)).toBeNull();
    expect(toProviderRating(3, 14 / 3)).toEqual({ average: 4.7, count: 3 });
  });
});
