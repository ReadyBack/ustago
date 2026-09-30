import { toPublicReview, toReviewDistribution } from './public-reviews.js';

describe('public reviews', () => {
  it('fills every star with 0 when missing', () => {
    expect(
      toReviewDistribution([
        { rating: 5, count: 7 },
        { rating: 2, count: 1 },
      ]),
    ).toEqual({ five: 7, four: 0, three: 0, two: 1, one: 0 });
  });

  it('maps an allow-list only: masked author, reply, no job or user ids', () => {
    const createdAt = new Date('2026-09-01T10:00:00Z');
    const review = toPublicReview({
      id: '0199a000-0000-7000-8000-000000000001',
      jobId: '0199a000-0000-7000-8000-000000000002',
      direction: 'CUSTOMER_TO_PROVIDER',
      authorId: '0199a000-0000-7000-8000-000000000003',
      targetId: '0199a000-0000-7000-8000-000000000004',
      rating: 4,
      qualityRating: 5,
      punctualityRating: null,
      communicationRating: 4,
      priceRating: 3,
      comment: 'İyi iş.',
      status: 'PUBLISHED',
      moderatedAt: null,
      moderatedById: null,
      moderationReason: null,
      createdAt,
      updatedAt: createdAt,
      author: { firstName: 'Ayşe', lastName: 'Demir' },
      job: { category: { name: 'Elektrik' } },
      reply: { body: 'Teşekkürler.', createdAt },
    });
    expect(review).toEqual({
      id: '0199a000-0000-7000-8000-000000000001',
      rating: 4,
      qualityRating: 5,
      communicationRating: 4,
      punctualityRating: null,
      valueRating: 3,
      comment: 'İyi iş.',
      authorName: 'Ayşe D.',
      categoryName: 'Elektrik',
      createdAt: createdAt.toISOString(),
      reply: { body: 'Teşekkürler.', createdAt: createdAt.toISOString() },
    });
  });
});
