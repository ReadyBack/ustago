import {
  jobSchema,
  paginatedSchema,
  jobListItemSchema,
  publicProviderProfileV2Schema,
  publicReviewSchema,
  reviewSchema,
} from '@ustago/validation';

import { bearer, cleanup, createTestApp, resetRateLimits, type TestContext } from './helpers.js';
import {
  agreedJob,
  agreedNowJob,
  answerChangeOrder,
  createChangeOrder,
  getJob,
  notificationsOf,
  postReview,
  proposeChangeOrder,
  startWork,
  step,
  stepOk,
} from './job-helpers.js';
import { adanaMarket, customerIn, type Market } from './marketplace-helpers.js';

describe('Job lifecycle (e2e)', () => {
  let ctx: TestContext;
  let m: Market;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetRateLimits(ctx);
    m = await adanaMarket(ctx);
  });

  afterAll(async () => {
    await m.restore();
    await cleanup(ctx);
    await ctx.app.close();
  });

  /**
   * The Faz 4 demo on real PostgreSQL, after the Faz 3 agreement at 2200 TL:
   * en route → arrived → started → +500 TL accepted (2700) → +300 TL
   * rejected (still 2700) → completion requested → completed → 5-star
   * review → the provider's public rating is real.
   */
  it('runs the full demo: 2200 → +500 accepted → +300 rejected → completed → reviewed', async () => {
    const job = await agreedJob(ctx, m);
    const { customer, provider, jobId } = job;

    const agreed = await getJob(ctx, customer, jobId);
    expect(agreed).toMatchObject({
      status: 'CREATED',
      agreedPrice: { amountMinor: 220000, currency: 'TRY' },
      currentTotal: { amountMinor: 220000, currency: 'TRY' },
      viewerRole: 'CUSTOMER',
    });
    expect(agreed.actions).toMatchObject({ cancel: true, complete: false, review: false });
    expect(agreed.timeline[0]).toMatchObject({ step: 'AGREED' });
    expect(agreed.timeline[0]?.at).not.toBeNull();
    expect(agreed.timeline.slice(1).every((t) => t.at === null)).toBe(true);
    const asProvider = await getJob(ctx, provider, jobId);
    expect(asProvider.viewerRole).toBe('PROVIDER');
    expect(asProvider.actions).toMatchObject({ enRoute: true, arrive: false, start: false });

    // Provider steps, each with a real timestamp and a customer notification.
    const enRoute = await stepOk(ctx, provider, jobId, 'en-route');
    expect(enRoute.status).toBe('PROVIDER_EN_ROUTE');
    expect(enRoute.enRouteAt).not.toBeNull();
    expect(enRoute.actions).toMatchObject({ enRoute: false, arrive: true, cancel: false });
    const arrived = await stepOk(ctx, provider, jobId, 'arrive');
    expect(arrived.status).toBe('PROVIDER_ARRIVED');
    const started = await stepOk(ctx, provider, jobId, 'start');
    expect(started.status).toBe('IN_PROGRESS');
    expect(started.actions).toMatchObject({ addChangeOrder: true, requestCompletion: true });
    const times = [started.enRouteAt, started.arrivedAt, started.startedAt].map((t) =>
      new Date(t ?? 0).getTime(),
    );
    expect(times).toEqual([...times].sort((a, b) => a - b));

    // Change order 1: +500 TL, accepted → 2700 TL; the agreed price stays.
    const co1 = await createChangeOrder(ctx, provider, jobId, 50000);
    expect(co1).toMatchObject({
      status: 'PENDING',
      amount: { amountMinor: 50000 },
      previousTotal: { amountMinor: 220000 },
      proposedTotal: { amountMinor: 270000 },
    });
    const waiting = await getJob(ctx, provider, jobId);
    expect(waiting.actions).toMatchObject({ requestCompletion: false, addChangeOrder: false });
    const blocked = await step(ctx, provider, jobId, 'request-completion').expect(409);
    expect(blocked.body.code).toBe('JOB_HAS_PENDING_CHANGE_ORDER');
    const second = await proposeChangeOrder(ctx, provider, jobId, 10000).expect(409);
    expect(second.body.code).toBe('CHANGE_ORDER_ALREADY_PENDING');

    await answerChangeOrder(ctx, customer, co1.id, 'accept').expect(200);
    let row = await ctx.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(row.agreedPriceMinor).toBe(220000n);
    expect(row.currentTotalMinor).toBe(270000n);

    // Change order 2: +300 TL, rejected → still 2700 TL.
    const co2 = await createChangeOrder(ctx, provider, jobId, 30000);
    expect(co2.proposedTotal.amountMinor).toBe(300000);
    const rejected = await answerChangeOrder(ctx, customer, co2.id, 'reject').expect(200);
    expect(rejected.body.status).toBe('REJECTED');
    row = await ctx.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(row.currentTotalMinor).toBe(270000n);
    expect(row.agreedPriceMinor).toBe(220000n);

    // Completion is requested by the provider and confirmed by the customer.
    const requested = await stepOk(ctx, provider, jobId, 'request-completion');
    expect(requested.status).toBe('AWAITING_COMPLETION_CONFIRMATION');
    const toConfirm = await getJob(ctx, customer, jobId);
    expect(toConfirm.actions).toMatchObject({ complete: true, dispute: true });
    const done = await stepOk(ctx, customer, jobId, 'complete');
    expect(done.status).toBe('COMPLETED');
    expect(done.currentTotal.amountMinor).toBe(270000);
    expect(done.actions.review).toBe(true);
    expect(done.timeline.every((t) => t.at !== null)).toBe(true);
    const request = await ctx.prisma.serviceRequest.findUniqueOrThrow({
      where: { id: job.requestId },
    });
    expect(request.status).toBe('COMPLETED');

    // No payment of any kind happened.
    expect(await ctx.prisma.payment.count({ where: { jobId } })).toBe(0);
    expect(await ctx.prisma.ledgerEntry.count({ where: { jobId } })).toBe(0);

    // Review, then a real public rating.
    const review = reviewSchema.parse(
      (
        await postReview(ctx, customer, jobId, {
          rating: 5,
          qualityRating: 5,
          communicationRating: 5,
          punctualityRating: 4,
          valueRating: 5,
          comment: 'Hızlı ve temiz çalıştı, ek işi de önceden sordu.',
        }).expect(201)
      ).body,
    );
    expect(review.rating).toBe(5);
    const again = await postReview(ctx, customer, jobId, { rating: 4 }).expect(409);
    expect(again.body.code).toBe('REVIEW_ALREADY_EXISTS');

    const profile = publicProviderProfileV2Schema.parse(
      (await ctx.http().get(`/api/v1/providers/${provider.providerId}`).expect(200)).body,
    );
    expect(profile.rating).toEqual({ average: 5, count: 1 });
    expect(profile.completedJobCount).toBe(1);
    expect(profile.isNewProvider).toBe(true);
    expect(profile.ustaScore).toBeNull(); // hidden until 3 completed jobs
    const reviews = paginatedSchema(publicReviewSchema).parse(
      (await ctx.http().get(`/api/v1/providers/${provider.providerId}/reviews`).expect(200)).body,
    );
    expect(reviews.items[0]).toMatchObject({ rating: 5, authorName: 'Test M.' });
    expect(JSON.stringify(reviews)).not.toMatch(/\+90|@|Atatürk|jobId/);

    // Notifications for every step, in Turkish, in the app.
    const toCustomer = (await notificationsOf(ctx, customer.userId)).map((n) => n.title);
    expect(toCustomer).toEqual(
      expect.arrayContaining([
        'Ustanız yola çıktı.',
        'Ustanız adrese ulaştı.',
        'Ustanız işe başladı.',
        'Ustanız ₺500 tutarında ek iş onayı istedi.',
        'Ustanız ₺300 tutarında ek iş onayı istedi.',
        'Ustanız işi tamamladığını bildirdi. Lütfen kontrol edin.',
      ]),
    );
    const toProvider = (await notificationsOf(ctx, provider.userId)).map((n) => n.title);
    expect(toProvider).toEqual(
      expect.arrayContaining([
        '₺500 ek iş talebiniz onaylandı.',
        'Ek iş talebiniz reddedildi.',
        'Müşteri işin tamamlandığını onayladı.',
        'Yeni değerlendirme: 5 üzerinden 5 yıldız',
      ]),
    );

    // Audit trail and status history.
    const audit = await ctx.prisma.auditLog.findMany({
      where: { OR: [{ entityId: jobId }, { entityId: review.id }] },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'job.en_route',
        'job.arrived',
        'job.started',
        'job.change_order.created',
        'job.change_order.accepted',
        'job.change_order.rejected',
        'job.completion_requested',
        'job.completed',
        'review.created',
      ]),
    );
    const history = await ctx.prisma.jobStatusHistory.findMany({
      where: { jobId },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.map((h) => h.toStatus)).toEqual([
      'CREATED',
      'PROVIDER_EN_ROUTE',
      'PROVIDER_ARRIVED',
      'IN_PROGRESS',
      'AWAITING_COMPLETION_CONFIRMATION',
      'COMPLETED',
    ]);

    // Lists: active vs finished.
    const finished = paginatedSchema(jobListItemSchema).parse(
      (
        await ctx
          .http()
          .get('/api/v1/jobs?role=CUSTOMER&scope=FINISHED')
          .set('Authorization', bearer(customer))
          .expect(200)
      ).body,
    );
    expect(finished.items.map((j) => j.id)).toContain(jobId);
    expect(finished.items.find((j) => j.id === jobId)?.currentTotal.amountMinor).toBe(270000);
    const active = await ctx
      .http()
      .get('/api/v1/jobs?role=CUSTOMER&scope=ACTIVE')
      .set('Authorization', bearer(customer))
      .expect(200);
    expect((active.body.items as { id: string }[]).map((j) => j.id)).not.toContain(jobId);
  });

  describe('state machine over HTTP', () => {
    it('is idempotent: a repeated step writes nothing twice', async () => {
      const job = await agreedJob(ctx, m);
      await stepOk(ctx, job.provider, job.jobId, 'en-route');
      const repeat = await stepOk(ctx, job.provider, job.jobId, 'en-route');
      expect(repeat.status).toBe('PROVIDER_EN_ROUTE');
      const history = await ctx.prisma.jobStatusHistory.count({
        where: { jobId: job.jobId, toStatus: 'PROVIDER_EN_ROUTE' },
      });
      expect(history).toBe(1);
      const audits = await ctx.prisma.auditLog.count({
        where: { entityId: job.jobId, action: 'job.en_route' },
      });
      expect(audits).toBe(1);
      const notes = await ctx.prisma.notification.count({
        where: { userId: job.customer.userId, type: 'job.en_route' },
      });
      expect(notes).toBe(1);
    });

    it('refuses skipped steps with 409 JOB_INVALID_TRANSITION and the current status', async () => {
      const job = await agreedJob(ctx, m);
      const res = await step(ctx, job.provider, job.jobId, 'start').expect(409);
      expect(res.body).toMatchObject({
        code: 'JOB_INVALID_TRANSITION',
        details: { status: 'CREATED' },
      });
      await step(ctx, job.provider, job.jobId, 'request-completion').expect(409);
      await step(ctx, job.customer, job.jobId, 'complete').expect(409);
    });

    it('lets only the provider move the work and only the customer confirm', async () => {
      const job = await agreedJob(ctx, m);
      const wrong = await step(ctx, job.customer, job.jobId, 'en-route').expect(403);
      expect(wrong.body.code).toBe('JOB_WRONG_PARTY');
      await startWork(ctx, job);
      await stepOk(ctx, job.provider, job.jobId, 'request-completion');
      await step(ctx, job.provider, job.jobId, 'complete').expect(403);
      const customerCo = await proposeChangeOrder(ctx, job.customer, job.jobId, 1000).expect(403);
      expect(customerCo.body.code).toBe('JOB_WRONG_PARTY');
    });

    it('never completes a job without the customer', async () => {
      const job = await agreedJob(ctx, m);
      await startWork(ctx, job);
      await stepOk(ctx, job.provider, job.jobId, 'request-completion');
      const row = await ctx.prisma.job.findUniqueOrThrow({ where: { id: job.jobId } });
      expect(row.status).toBe('AWAITING_COMPLETION_CONFIRMATION');
      expect(row.completedAt).toBeNull();
    });

    it('refuses change orders before the work started', async () => {
      const job = await agreedJob(ctx, m);
      const early = await proposeChangeOrder(ctx, job.provider, job.jobId, 50000).expect(409);
      expect(early.body.code).toBe('CHANGE_ORDER_NOT_ALLOWED');
    });

    it('validates change order amounts (positive integer kuruş)', async () => {
      const job = await agreedJob(ctx, m);
      await startWork(ctx, job);
      for (const amount of [0, -5000, 12.5]) {
        await proposeChangeOrder(ctx, job.provider, job.jobId, amount).expect(400);
      }
      const bad = await proposeChangeOrder(ctx, job.provider, job.jobId, 0).expect(400);
      expect(bad.body.code).toBe('VALIDATION_FAILED');
      // Within the per-price limit, but the job total would pass the ceiling.
      const ceiling = await proposeChangeOrder(ctx, job.provider, job.jobId, 999_900_000).expect(
        422,
      );
      expect(ceiling.body.code).toBe('CHANGE_ORDER_INVALID_AMOUNT');
    });

    it('lets the provider withdraw a pending change order', async () => {
      const job = await agreedJob(ctx, m);
      await startWork(ctx, job);
      const co = await createChangeOrder(ctx, job.provider, job.jobId, 20000);
      await answerChangeOrder(ctx, job.customer, co.id, 'cancel').expect(403);
      const withdrawn = await answerChangeOrder(ctx, job.provider, co.id, 'cancel').expect(200);
      expect(withdrawn.body.status).toBe('CANCELLED');
      const late = await answerChangeOrder(ctx, job.customer, co.id, 'accept').expect(409);
      expect(late.body.code).toBe('CHANGE_ORDER_NOT_PENDING');
      await stepOk(ctx, job.provider, job.jobId, 'request-completion');
    });
  });

  describe('cancellation', () => {
    it('customer cancels before the provider leaves; the request is cancelled too', async () => {
      const job = await agreedJob(ctx, m);
      await step(ctx, job.customer, job.jobId, 'cancel', { reason: '' }).expect(400);
      const cancelled = await stepOk(ctx, job.customer, job.jobId, 'cancel', {
        reason: 'Planım değişti',
      });
      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.cancellationActor).toBe('CUSTOMER');
      const request = await ctx.prisma.serviceRequest.findUniqueOrThrow({
        where: { id: job.requestId },
      });
      expect(request.status).toBe('CANCELLED');
      const note = await ctx.prisma.notification.findFirst({
        where: { userId: job.provider.userId, type: 'job.cancelled' },
      });
      expect(note?.title).toBe('Müşteri işi iptal etti.');
      await step(ctx, job.provider, job.jobId, 'en-route').expect(409);
    });

    it('records a provider cancellation against the provider', async () => {
      const job = await agreedJob(ctx, m);
      const cancelled = await stepOk(ctx, job.provider, job.jobId, 'cancel', {
        reason: 'Aracım arızalandı',
      });
      expect(cancelled.cancellationActor).toBe('PROVIDER');
    });

    it('cannot cancel once the provider is on the way', async () => {
      const job = await agreedJob(ctx, m);
      await stepOk(ctx, job.provider, job.jobId, 'en-route');
      await step(ctx, job.customer, job.jobId, 'cancel', { reason: 'Vazgeçtim' }).expect(409);
    });
  });

  describe('disputes', () => {
    it('before arrival allows only "Usta gelmedi"', async () => {
      const job = await agreedJob(ctx, m);
      await stepOk(ctx, job.provider, job.jobId, 'en-route');
      const wrong = await step(ctx, job.customer, job.jobId, 'dispute', {
        reason: 'POOR_QUALITY',
        description: 'İş kötü yapıldı diye düşünüyorum.',
      }).expect(422);
      expect(wrong.body.code).toBe('DISPUTE_REASON_NOT_ALLOWED');
      const noShow = await stepOk(ctx, job.customer, job.jobId, 'dispute', {
        reason: 'NO_SHOW',
        description: 'Usta iki saattir gelmedi, telefona da çıkmıyor.',
      });
      expect(noShow.status).toBe('DISPUTED');
      expect(noShow.dispute).toMatchObject({ status: 'OPEN', reason: 'NO_SHOW' });
    });

    it('"Sorun Bildir" on a completion request moves the job to DISPUTED', async () => {
      const job = await agreedJob(ctx, m);
      await startWork(ctx, job);
      const co = await createChangeOrder(ctx, job.provider, job.jobId, 10000);
      await answerChangeOrder(ctx, job.customer, co.id, 'reject').expect(200);
      await stepOk(ctx, job.provider, job.jobId, 'request-completion');
      const disputed = await stepOk(ctx, job.customer, job.jobId, 'dispute', {
        reason: 'POOR_QUALITY',
        description: 'Klima hâlâ su akıtıyor, iş bitmedi.',
      });
      expect(disputed.status).toBe('DISPUTED');
      expect(disputed.actions.complete).toBe(false);
      const again = await step(ctx, job.customer, job.jobId, 'dispute', {
        reason: 'OTHER',
        description: 'Bir kez daha bildiriyorum.',
      }).expect(409);
      expect(again.body.code).toBe('DISPUTE_ALREADY_OPEN');
      expect(await ctx.prisma.dispute.count({ where: { jobId: job.jobId } })).toBe(1);
      const note = await ctx.prisma.notification.findFirst({
        where: { userId: job.provider.userId, type: 'job.disputed' },
      });
      expect(note).not.toBeNull();
      // A disputed job cannot be reviewed.
      const review = await postReview(ctx, job.customer, job.jobId, { rating: 1 }).expect(409);
      expect(review.body.code).toBe('REVIEW_NOT_ALLOWED');
    });
  });

  describe('privacy (IDOR)', () => {
    it('hides a job and its change orders from everyone else (404)', async () => {
      const job = await agreedJob(ctx, m);
      await startWork(ctx, job);
      const co = await createChangeOrder(ctx, job.provider, job.jobId, 15000);
      const stranger = await customerIn(ctx, m.seyhan);
      await ctx
        .http()
        .get(`/api/v1/jobs/${job.jobId}`)
        .set('Authorization', bearer(stranger))
        .expect(404);
      const steal = await step(ctx, stranger, job.jobId, 'request-completion').expect(404);
      expect(steal.body.code).toBe('JOB_NOT_FOUND');
      const accept = await answerChangeOrder(ctx, stranger, co.id, 'accept').expect(404);
      expect(accept.body.code).toBe('CHANGE_ORDER_NOT_FOUND');
      await ctx
        .http()
        .get(`/api/v1/jobs/${job.jobId}/change-orders`)
        .set('Authorization', bearer(stranger))
        .expect(404);
      await postReview(ctx, stranger, job.jobId, { rating: 5 }).expect(404);
      const row = await ctx.prisma.changeOrder.findUniqueOrThrow({ where: { id: co.id } });
      expect(row.status).toBe('PENDING');
    });

    it('requires authentication', async () => {
      const job = await agreedJob(ctx, m);
      await ctx.http().post(`/api/v1/jobs/${job.jobId}/en-route`).expect(401);
    });
  });

  it('NOW jobs follow the same lifecycle end to end', async () => {
    const job = await agreedNowJob(ctx, m);
    const created = await getJob(ctx, job.customer, job.jobId);
    expect(created.serviceRequest.type).toBe('NOW');
    await startWork(ctx, job);
    await stepOk(ctx, job.provider, job.jobId, 'request-completion');
    const done = await stepOk(ctx, job.customer, job.jobId, 'complete');
    expect(done.status).toBe('COMPLETED');
    expect(done.agreedPrice.amountMinor).toBe(120000);
    await postReview(ctx, job.customer, job.jobId, { rating: 4 }).expect(201);
    const parsed = jobSchema.parse(await getJob(ctx, job.customer, job.jobId));
    expect(parsed.review?.rating).toBe(4);
    expect(parsed.actions).toMatchObject({ review: false, editReview: true });
  });
});
