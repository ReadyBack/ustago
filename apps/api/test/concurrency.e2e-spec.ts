import { randomUUID } from 'node:crypto';

import { bearer, cleanup, createTestApp, resetRateLimits, type TestContext } from './helpers.js';
import {
  accept,
  adanaMarket,
  counter,
  createQuote,
  createRequest,
  customerIn,
  type Market,
  postQuote,
  postRequest,
  providerIn,
} from './marketplace-helpers.js';

const statuses = (results: { status: number }[]) => results.map((r) => r.status).sort();

/**
 * Races fired in parallel against the real database. The guarantees come
 * from row locks, conditional updates and unique indexes, never from the
 * client behaving.
 */
describe('Marketplace concurrency (e2e)', () => {
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

  const klimaProvider = (now = false) =>
    providerIn(ctx, {
      categoryIds: [m.klimaId],
      districtIds: [m.seyhan],
      nowEnabled: now,
      isAvailableNow: now,
    });

  it('two accepts on two different quotes: exactly one job', async () => {
    const customer = await customerIn(ctx, m.seyhan);
    const [a, b] = await Promise.all([klimaProvider(), klimaProvider()]);
    const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
    const qa = await createQuote(ctx, a, request.id, 200000);
    const qb = await createQuote(ctx, b, request.id, 210000);

    const results = await Promise.all([
      accept(ctx, customer, qa.id, 1),
      accept(ctx, customer, qb.id, 1),
    ]);
    expect(statuses(results)).toEqual([200, 409]);
    expect(await ctx.prisma.job.count({ where: { serviceRequestId: request.id } })).toBe(1);
    expect(
      await ctx.prisma.quote.count({ where: { serviceRequestId: request.id, status: 'ACCEPTED' } }),
    ).toBe(1);
  });

  it('the same accept sent twice (double tap): one job', async () => {
    const customer = await customerIn(ctx, m.seyhan);
    const provider = await klimaProvider();
    const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
    const quote = await createQuote(ctx, provider, request.id, 200000);
    const results = await Promise.all([
      accept(ctx, customer, quote.id, 1),
      accept(ctx, customer, quote.id, 1),
      accept(ctx, customer, quote.id, 1),
    ]);
    expect(statuses(results)).toEqual([200, 409, 409]);
    expect(await ctx.prisma.job.count({ where: { serviceRequestId: request.id } })).toBe(1);
  });

  it('counter and accept at the same moment: one wins, state stays consistent', async () => {
    const customer = await customerIn(ctx, m.seyhan);
    const provider = await klimaProvider();
    const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
    const quote = await createQuote(ctx, provider, request.id, 250000);
    await counter(ctx, customer, quote.id, 200000, 1).expect(200);

    // Provider's turn; provider taps "accept" while also sending a counter
    // from a second device.
    const results = await Promise.all([
      accept(ctx, provider, quote.id, 2),
      counter(ctx, provider, quote.id, 220000, 2),
    ]);
    expect(statuses(results)).toEqual([200, 409]);
    const row = await ctx.prisma.quote.findUniqueOrThrow({
      where: { id: quote.id },
      include: { revisions: true },
    });
    if (row.status === 'ACCEPTED') {
      expect(row.revisions).toHaveLength(2);
      const job = await ctx.prisma.job.findUniqueOrThrow({
        where: { serviceRequestId: request.id },
      });
      expect(job.agreedPriceMinor).toBe(200000n);
    } else {
      expect(row.status).toBe('PENDING_CUSTOMER');
      expect(row.revisions).toHaveLength(3);
      expect(await ctx.prisma.job.count({ where: { serviceRequestId: request.id } })).toBe(0);
    }
  });

  it('two counters for the same revision: one revision is written', async () => {
    const customer = await customerIn(ctx, m.seyhan);
    const provider = await klimaProvider();
    const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
    const quote = await createQuote(ctx, provider, request.id, 250000);
    const results = await Promise.all([
      counter(ctx, customer, quote.id, 200000, 1),
      counter(ctx, customer, quote.id, 210000, 1),
    ]);
    expect(statuses(results)).toEqual([200, 409]);
    expect(await ctx.prisma.quoteRevision.count({ where: { quoteId: quote.id } })).toBe(2);
  });

  it('cancel and accept at the same moment: never a job on a cancelled request', async () => {
    const customer = await customerIn(ctx, m.seyhan);
    const provider = await klimaProvider();
    const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
    const quote = await createQuote(ctx, provider, request.id, 200000);
    const results = await Promise.all([
      accept(ctx, customer, quote.id, 1),
      ctx
        .http()
        .post(`/api/v1/service-requests/${request.id}/cancel`)
        .set('Authorization', bearer(customer))
        .send({}),
    ]);
    expect(statuses(results)).toEqual([200, 409]);
    const req = await ctx.prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
    const jobs = await ctx.prisma.job.count({ where: { serviceRequestId: request.id } });
    if (req.status === 'MATCHED') expect(jobs).toBe(1);
    else {
      expect(req.status).toBe('CANCELLED');
      expect(jobs).toBe(0);
    }
  });

  it('one provider sending the first quote twice: one quote', async () => {
    const customer = await customerIn(ctx, m.seyhan);
    const provider = await klimaProvider();
    const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
    const results = await Promise.all([
      postQuote(ctx, provider, request.id, { totalMinor: 200000 }),
      postQuote(ctx, provider, request.id, { totalMinor: 200000 }),
    ]);
    expect(statuses(results)).toEqual([201, 409]);
    expect(await ctx.prisma.quote.count({ where: { serviceRequestId: request.id } })).toBe(1);
  });

  it('NOW: several providers race; the customer’s one accept wins', async () => {
    const customer = await customerIn(ctx, m.seyhan);
    const providers = await Promise.all([
      klimaProvider(true),
      klimaProvider(true),
      klimaProvider(true),
    ]);
    const request = await createRequest(ctx, customer, { type: 'NOW', categoryId: m.klimaId });
    const quotes = await Promise.all(
      providers.map((p, i) => createQuote(ctx, p, request.id, 100000 + i * 5000)),
    );
    const results = await Promise.all(quotes.map((q) => accept(ctx, customer, q.id, 1)));
    expect(statuses(results)).toEqual([200, 409, 409]);
    expect(await ctx.prisma.job.count({ where: { serviceRequestId: request.id } })).toBe(1);
    const offers = await ctx.prisma.emergencyDispatchOffer.groupBy({
      by: ['status'],
      where: { serviceRequestId: request.id },
      _count: true,
    });
    expect(Object.fromEntries(offers.map((o) => [o.status, o._count]))).toEqual({
      ACCEPTED: 1,
      SUPERSEDED: 2,
    });
  });

  it('double publish and a repeated create key stay single', async () => {
    const customer = await customerIn(ctx, m.seyhan);
    const draft = await createRequest(ctx, customer, { categoryId: m.klimaId, publish: false });
    const publish = () =>
      ctx
        .http()
        .post(`/api/v1/service-requests/${draft.id}/publish`)
        .set('Authorization', bearer(customer));
    const published = await Promise.all([publish(), publish()]);
    expect(statuses(published)).toEqual([200, 200]);
    expect(
      await ctx.prisma.auditLog.count({
        where: { entityId: draft.id, action: 'service_request.published' },
      }),
    ).toBe(1);

    const idempotencyKey = randomUUID();
    const created = await Promise.all([
      postRequest(ctx, customer, { categoryId: m.klimaId, idempotencyKey }),
      postRequest(ctx, customer, { categoryId: m.klimaId, idempotencyKey }),
    ]);
    expect(statuses(created)).toEqual([201, 201]);
    expect(created[0]?.body.id).toBe(created[1]?.body.id);
  });
});
