import { bearer, cleanup, createTestApp, resetRateLimits, type TestContext } from './helpers.js';
import { agreedJob, type AgreedJob } from './job-helpers.js';
import { adanaMarket, customerIn, type Market } from './marketplace-helpers.js';
import { adminActor, createPayment, idemKey, payOnline, simulate } from './finance-helpers.js';
import type { Actor } from './provider-helpers.js';

const ADMIN_ROUTES = [
  ['get', '/api/v1/admin/finance/summary'],
  ['get', '/api/v1/admin/finance/payments'],
  ['get', '/api/v1/admin/finance/ledger'],
  ['get', '/api/v1/admin/finance/payouts'],
  ['get', '/api/v1/admin/finance/cash-settlements'],
  ['get', '/api/v1/admin/finance/reconciliation'],
] as const;

describe('Finance: authorization and object access', () => {
  let ctx: TestContext;
  let m: Market;
  let job: AgreedJob;
  let other: AgreedJob;
  let admin: Actor;
  let paymentId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetRateLimits(ctx);
    m = await adanaMarket(ctx);
    admin = await adminActor(ctx);
    job = await agreedJob(ctx, m);
    other = await agreedJob(ctx, m);
    paymentId = (await payOnline(ctx, job.customer, job.jobId)).id;
  });

  afterAll(async () => {
    await cleanup(ctx);
    await ctx.app.close();
  });

  it('admin finance needs the ADMIN role', async () => {
    for (const [, path] of ADMIN_ROUTES) {
      await ctx.http().get(path).expect(401);
      await ctx.http().get(path).set('Authorization', bearer(job.customer)).expect(403);
      await ctx.http().get(path).set('Authorization', bearer(job.provider)).expect(403);
      await ctx.http().get(path).set('Authorization', bearer(admin)).expect(200);
    }
    await ctx
      .http()
      .post(`/api/v1/admin/dev/payouts/${paymentId}/mark-paid`)
      .set('Authorization', bearer(job.provider))
      .send()
      .expect(403);
  });

  it("other people's jobs, payments and earnings answer 404", async () => {
    await ctx
      .http()
      .get(`/api/v1/jobs/${job.jobId}/payment-summary`)
      .set('Authorization', bearer(other.customer))
      .expect(404);
    await ctx
      .http()
      .get(`/api/v1/me/payments/${paymentId}`)
      .set('Authorization', bearer(other.customer))
      .expect(404);
    const earning = await ctx.prisma.providerEarning.findUniqueOrThrow({ where: { paymentId } });
    await ctx
      .http()
      .get(`/api/v1/me/earnings/${earning.id}`)
      .set('Authorization', bearer(other.provider))
      .expect(404);
    await ctx
      .http()
      .get(`/api/v1/me/earnings/${earning.id}`)
      .set('Authorization', bearer(job.provider))
      .expect(200);
    // Somebody else cannot decide my test payment.
    const created = await createPayment(ctx, other.customer, other.jobId).expect(200);
    await simulate(ctx, job.customer, created.body.id, 'SUCCESS').expect(404);
  });

  it('an Idempotency-Key cannot be reused for another job', async () => {
    const key = idemKey();
    const third = await agreedJob(ctx, m, { customer: other.customer });
    await createPayment(ctx, other.customer, third.jobId, key).expect(200);
    const fourth = await agreedJob(ctx, m, { customer: other.customer });
    await createPayment(ctx, other.customer, fourth.jobId, key)
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED'));
  });

  it('the payer cannot choose an amount', async () => {
    const fresh = await agreedJob(ctx, m);
    const res = await ctx
      .http()
      .post(`/api/v1/jobs/${fresh.jobId}/payments`)
      .set('Authorization', bearer(fresh.customer))
      .set('Idempotency-Key', idemKey())
      .send({ amountMinor: 1 })
      .expect(200);
    expect(res.body.amount.amountMinor).toBe(220000);
  });
});

describe('Finance: switches fail closed', () => {
  it('without the mock provider the dev routes and the mock webhook do not exist', async () => {
    const ctx = await createTestApp({ PAYMENT_PROVIDER: 'disabled', PAYOUT_PROVIDER: 'disabled' });
    try {
      await resetRateLimits(ctx);
      const m = await adanaMarket(ctx);
      const customer = await customerIn(ctx, m.seyhan);
      const admin = await adminActor(ctx);
      const id = '01900000-0000-7000-8000-000000000000';
      await ctx
        .http()
        .post(`/api/v1/dev/payments/${id}/simulate`)
        .set('Authorization', bearer(customer))
        .send({ outcome: 'SUCCESS' })
        .expect(404);
      await ctx
        .http()
        .post(`/api/v1/admin/dev/payouts/${id}/mark-paid`)
        .set('Authorization', bearer(admin))
        .send()
        .expect(404);
      await ctx.http().post('/api/v1/webhooks/payments/mock').send('{}').expect(404);
      const summary = await ctx
        .http()
        .get('/api/v1/admin/finance/summary')
        .set('Authorization', bearer(admin))
        .expect(200);
      expect(summary.body.testMode).toBe(false);
    } finally {
      await cleanup(ctx);
      await ctx.app.close();
    }
  });

  it('PAYMENTS_ENABLED=false closes online payment; PAYOUTS_ENABLED=false closes payouts', async () => {
    const ctx = await createTestApp({ PAYMENTS_ENABLED: 'false', PAYOUTS_ENABLED: 'false' });
    try {
      await resetRateLimits(ctx);
      const m = await adanaMarket(ctx);
      const job = await agreedJob(ctx, m);
      await createPayment(ctx, job.customer, job.jobId)
        .expect(503)
        .expect((res) => expect(res.body.code).toBe('PAYMENTS_DISABLED'));
      await ctx
        .http()
        .post('/api/v1/me/payouts')
        .set('Authorization', bearer(job.provider))
        .set('Idempotency-Key', idemKey())
        .send({ amountMinor: 10000 })
        .expect(503);
      // Cash still works.
      await ctx
        .http()
        .put(`/api/v1/jobs/${job.jobId}/payment-method`)
        .set('Authorization', bearer(job.customer))
        .send({ method: 'CASH' })
        .expect(200);
    } finally {
      await cleanup(ctx);
      await ctx.app.close();
    }
  });
});
