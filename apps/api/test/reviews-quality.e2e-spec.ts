import {
  adminReviewSchema,
  paginatedSchema,
  providerQualitySchema,
  publicProviderProfileSchema,
  reviewSchema,
} from '@ustago/validation';

import {
  bearer,
  cleanup,
  createStaffUser,
  createTestApp,
  resetRateLimits,
  type TestContext,
} from './helpers.js';
import { agreedJob, completedJob, postReview, stepOk } from './job-helpers.js';
import {
  adanaMarket,
  createRequest,
  customerIn,
  type Market,
  opportunityIds,
  providerIn,
} from './marketplace-helpers.js';

describe('Reviews, provider quality and sanctions (e2e)', () => {
  let ctx: TestContext;
  let m: Market;
  let admin: Awaited<ReturnType<typeof createStaffUser>>;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetRateLimits(ctx);
    m = await adanaMarket(ctx);
    admin = await createStaffUser(ctx, ['ADMIN']);
  });

  afterAll(async () => {
    await m.restore();
    await cleanup(ctx);
    await ctx.app.close();
  });

  const profile = async (providerId: string) =>
    publicProviderProfileSchema.parse(
      (await ctx.http().get(`/api/v1/providers/${providerId}`).expect(200)).body,
    );

  it('shows "Yeni Usta" with no invented rating before the first review', async () => {
    const provider = await providerIn(ctx, { categoryIds: [m.klimaId], districtIds: [m.seyhan] });
    const p = await profile(provider.providerId);
    expect(p).toMatchObject({
      rating: null,
      completedJobCount: 0,
      ustaScore: null,
      isNewProvider: true,
    });
    expect(JSON.stringify(p)).not.toMatch(/\+90|@ustago/);
  });

  it('validates reviews: rating 1-5, plain text, max 1000 characters', async () => {
    const job = await completedJob(ctx, m);
    await postReview(ctx, job.customer, job.jobId, { rating: 0 }).expect(400);
    await postReview(ctx, job.customer, job.jobId, { rating: 6 }).expect(400);
    await postReview(ctx, job.customer, job.jobId, { rating: 4.5 }).expect(400);
    await postReview(ctx, job.customer, job.jobId, {
      rating: 5,
      comment: '<img src=x onerror=alert(1)>',
    }).expect(400);
    await postReview(ctx, job.customer, job.jobId, { rating: 5, comment: 'x'.repeat(1001) }).expect(
      400,
    );
    // The provider cannot review their own job as a customer.
    const own = await postReview(ctx, job.provider, job.jobId, { rating: 5 }).expect(403);
    expect(own.body.code).toBe('REVIEW_NOT_ALLOWED');
    await postReview(ctx, job.customer, job.jobId, { rating: 5, comment: 'Temiz iş.' }).expect(201);
  });

  it('refuses a review before the job is completed', async () => {
    const job = await agreedJob(ctx, m);
    const res = await postReview(ctx, job.customer, job.jobId, { rating: 5 }).expect(409);
    expect(res.body.code).toBe('REVIEW_NOT_ALLOWED');
  });

  it('lets the author edit within 30 days (audited with previous values), not after', async () => {
    const job = await completedJob(ctx, m);
    const review = reviewSchema.parse(
      (
        await postReview(ctx, job.customer, job.jobId, {
          rating: 3,
          comment: 'İdare eder.',
        }).expect(201)
      ).body,
    );
    const edited = reviewSchema.parse(
      (
        await ctx
          .http()
          .patch(`/api/v1/reviews/${review.id}`)
          .set('Authorization', bearer(job.customer))
          .send({ rating: 4, comment: 'Sonradan tekrar geldi ve düzeltti.' })
          .expect(200)
      ).body,
    );
    expect(edited).toMatchObject({ rating: 4, comment: 'Sonradan tekrar geldi ve düzeltti.' });
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { entityId: review.id, action: 'review.updated' },
    });
    expect(audit.metadata).toMatchObject({ previous: { rating: 3, comment: 'İdare eder.' } });

    // Someone else's review looks missing.
    await ctx
      .http()
      .patch(`/api/v1/reviews/${review.id}`)
      .set('Authorization', bearer(job.provider))
      .send({ rating: 1 })
      .expect(404);

    // 31 days later the window is closed.
    await ctx.prisma.review.update({
      where: { id: review.id },
      data: { createdAt: new Date(Date.now() - 31 * 24 * 3600 * 1000) },
    });
    const late = await ctx
      .http()
      .patch(`/api/v1/reviews/${review.id}`)
      .set('Authorization', bearer(job.customer))
      .send({ rating: 5 })
      .expect(409);
    expect(late.body.code).toBe('REVIEW_NOT_EDITABLE');
  });

  it('computes the real average and hides hidden reviews from it (admin moderation)', async () => {
    const provider = await providerIn(ctx, {
      categoryIds: [m.klimaId],
      districtIds: [m.seyhan, m.cukurova],
    });
    const ratings = [5, 4, 5];
    const reviewIds: string[] = [];
    for (const rating of ratings) {
      const job = await completedJob(ctx, m, await agreedJob(ctx, m, { provider }));
      const res = await postReview(ctx, job.customer, job.jobId, { rating }).expect(201);
      reviewIds.push(res.body.id as string);
    }
    let p = await profile(provider.providerId);
    expect(p.rating).toEqual({ average: 4.7, count: 3 });
    expect(p.completedJobCount).toBe(3);
    expect(p.isNewProvider).toBe(false);
    expect(p.ustaScore).not.toBeNull();
    expect(p.ustaScore).toBeGreaterThan(0);
    expect(p.ustaScore).toBeLessThanOrEqual(100);

    // Admin hides the 4-star review: average 5.0 over 2.
    const target = reviewIds[1] ?? '';
    const hidden = adminReviewSchema.parse(
      (
        await ctx
          .http()
          .post(`/api/v1/admin/reviews/${target}/hide`)
          .set('Authorization', bearer(admin))
          .send({ reason: 'Kişisel bilgi içeriyor' })
          .expect(200)
      ).body,
    );
    expect(hidden.status).toBe('HIDDEN');
    p = await profile(provider.providerId);
    expect(p.rating).toEqual({ average: 5, count: 2 });
    const publicList = await ctx
      .http()
      .get(`/api/v1/providers/${provider.providerId}/reviews`)
      .expect(200);
    expect((publicList.body.items as { id: string }[]).map((r) => r.id)).not.toContain(target);
    await ctx
      .http()
      .post(`/api/v1/admin/reviews/${target}/hide`)
      .set('Authorization', bearer(admin))
      .send({ reason: 'tekrar' })
      .expect(409);

    // Restore brings it back.
    await ctx
      .http()
      .post(`/api/v1/admin/reviews/${target}/restore`)
      .set('Authorization', bearer(admin))
      .send({ reason: 'İtiraz kabul edildi' })
      .expect(200);
    p = await profile(provider.providerId);
    expect(p.rating).toEqual({ average: 4.7, count: 3 });
    const actions = await ctx.prisma.auditLog.findMany({
      where: { entityId: target },
      select: { action: true },
    });
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining(['review.created', 'review.hidden', 'review.restored']),
    );
    const list = paginatedSchema(adminReviewSchema).parse(
      (
        await ctx
          .http()
          .get(`/api/v1/admin/reviews?providerId=${provider.providerId}`)
          .set('Authorization', bearer(admin))
          .expect(200)
      ).body,
    );
    expect(list.items).toHaveLength(3);
    expect(list.items.every((r) => /^\S+ \S\.$/.test(r.customerName))).toBe(true);

    // Quality view: real counts and the score's factors.
    const quality = providerQualitySchema.parse(
      (
        await ctx
          .http()
          .get(`/api/v1/admin/providers/${provider.providerId}/quality`)
          .set('Authorization', bearer(admin))
          .expect(200)
      ).body,
    );
    expect(quality).toMatchObject({
      completedJobs: 3,
      reviewCount: 3,
      ratingAverage: 4.7,
      openDisputes: 0,
      isNewProvider: false,
    });
    expect(quality.factors.find((f) => f.key === 'REVIEWS')?.score).not.toBeNull();
  });

  it('does not count customer cancellations against the provider', async () => {
    const provider = await providerIn(ctx, { categoryIds: [m.klimaId], districtIds: [m.seyhan] });
    for (let i = 0; i < 3; i += 1) {
      const job = await agreedJob(ctx, m, { provider });
      await stepOk(ctx, job.customer, job.jobId, 'cancel', { reason: 'Planım değişti' });
    }
    const quality = providerQualitySchema.parse(
      (
        await ctx
          .http()
          .get(`/api/v1/admin/providers/${provider.providerId}/quality`)
          .set('Authorization', bearer(admin))
          .expect(200)
      ).body,
    );
    expect(quality).toMatchObject({ customerCancelledJobs: 3, providerCancelledJobs: 0 });
    expect(quality.factors.find((f) => f.key === 'CANCELLATION')?.score).toBeNull();
  });

  it('applies admin sanctions: NOW suspension hides NOW requests, revoke restores', async () => {
    const provider = await providerIn(ctx, {
      categoryIds: [m.klimaId],
      districtIds: [m.seyhan],
      nowEnabled: true,
      isAvailableNow: true,
    });
    const customer = await customerIn(ctx, m.seyhan);
    const now = await createRequest(ctx, customer, {
      type: 'NOW',
      categoryId: m.klimaId,
      budgetMinor: null,
    });
    const quote = await createRequest(ctx, customer, { categoryId: m.klimaId });
    expect(await opportunityIds(ctx, provider)).toEqual(expect.arrayContaining([now.id, quote.id]));

    // Non-admins cannot sanction.
    await ctx
      .http()
      .post(`/api/v1/admin/providers/${provider.providerId}/penalties`)
      .set('Authorization', bearer(customer))
      .send({ type: 'WARNING', reasonCode: 'NO_SHOW', reason: 'Deneme amaçlı yaptırım.' })
      .expect(403);
    // Account-level sanctions are not created here.
    await ctx
      .http()
      .post(`/api/v1/admin/providers/${provider.providerId}/penalties`)
      .set('Authorization', bearer(admin))
      .send({ type: 'PERMANENT_BAN', reasonCode: 'FRAUD', reason: 'Bu yol kapalı olmalı.' })
      .expect(400);

    const penalty = await ctx
      .http()
      .post(`/api/v1/admin/providers/${provider.providerId}/penalties`)
      .set('Authorization', bearer(admin))
      .send({
        type: 'NOW_SUSPENSION',
        reasonCode: 'NO_SHOW',
        reason: 'İki acil işe gelmediği sorun bildirimleriyle doğrulandı.',
      })
      .expect(201);
    expect(penalty.body).toMatchObject({ severity: 'MAJOR', status: 'ACTIVE' });
    const visible = await opportunityIds(ctx, provider);
    expect(visible).toContain(quote.id);
    expect(visible).not.toContain(now.id);

    const quality = providerQualitySchema.parse(
      (
        await ctx
          .http()
          .get(`/api/v1/admin/providers/${provider.providerId}/quality`)
          .set('Authorization', bearer(admin))
          .expect(200)
      ).body,
    );
    expect(quality.penaltyPoints).toBe(20);
    expect(quality.penalties[0]).toMatchObject({ type: 'NOW_SUSPENSION', status: 'ACTIVE' });

    await ctx
      .http()
      .post(`/api/v1/admin/penalties/${penalty.body.id as string}/revoke`)
      .set('Authorization', bearer(admin))
      .send({ reason: 'İtiraz kabul edildi' })
      .expect(200);
    expect(await opportunityIds(ctx, provider)).toContain(now.id);
    const audit = await ctx.prisma.auditLog.findMany({
      where: { entityId: provider.providerId, action: { startsWith: 'provider.penalty.' } },
    });
    expect(audit.map((a) => a.action).sort()).toEqual([
      'provider.penalty.created',
      'provider.penalty.revoked',
    ]);
  });

  it('job restriction hides every new request', async () => {
    const provider = await providerIn(ctx, { categoryIds: [m.klimaId], districtIds: [m.seyhan] });
    const customer = await customerIn(ctx, m.seyhan);
    const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
    await ctx
      .http()
      .post(`/api/v1/admin/providers/${provider.providerId}/penalties`)
      .set('Authorization', bearer(admin))
      .send({
        type: 'JOB_RESTRICTION',
        reasonCode: 'QUALITY_REVIEW',
        reason: 'Kalite incelemesi sürerken yeni iş alamaz.',
        endsAt: new Date(Date.now() + 86400_000).toISOString(),
      })
      .expect(201);
    expect(await opportunityIds(ctx, provider)).not.toContain(request.id);
  });
});
