import { describe, expect, it } from 'vitest';

import { INITIAL_JOB_STATUS, jobFromAcceptedDeal } from './job-creation.js';

const deal = {
  serviceRequest: {
    id: 'request',
    customerId: 'customer',
    categoryId: 'klima',
    preferredStartAt: new Date('2026-10-01T09:00:00Z'),
  },
  quote: { id: 'quote', providerId: 'provider' },
  revision: {
    id: 'rev-3',
    totalMinor: 220000n,
    currency: 'TRY' as const,
    availableFrom: null,
  },
};

describe('job creation', () => {
  it('locks the accepted revision price as AGREED_PRICE', () => {
    const job = jobFromAcceptedDeal(deal);
    expect(job.agreedPriceMinor).toBe(220000n);
    expect(job.currentTotalMinor).toBe(220000n);
    expect(job.currency).toBe('TRY');
    expect(job.status).toBe(INITIAL_JOB_STATUS);
    expect(job.acceptedRevisionId).toBe('rev-3');
  });

  it('links the right customer, provider and category', () => {
    const job = jobFromAcceptedDeal(deal);
    expect(job).toMatchObject({
      serviceRequestId: 'request',
      quoteId: 'quote',
      customerId: 'customer',
      providerId: 'provider',
      categoryId: 'klima',
    });
  });

  it("schedules at the provider's availability, else the customer's preference", () => {
    expect(jobFromAcceptedDeal(deal).scheduledStartAt).toEqual(
      new Date('2026-10-01T09:00:00Z'),
    );
    const at = new Date('2026-10-02T12:00:00Z');
    expect(
      jobFromAcceptedDeal({ ...deal, revision: { ...deal.revision, availableFrom: at } })
        .scheduledStartAt,
    ).toEqual(at);
  });

  it('refuses a non-positive price', () => {
    expect(() =>
      jobFromAcceptedDeal({ ...deal, revision: { ...deal.revision, totalMinor: 0n } }),
    ).toThrow(RangeError);
  });
});
