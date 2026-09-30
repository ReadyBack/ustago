import {
  jobSchema,
  paginatedSchema,
  providerQuoteListItemSchema,
  quoteSchema,
  serviceRequestSchema,
} from '@ustago/validation';

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
  providerIn,
} from './marketplace-helpers.js';

describe('Quotes and negotiation (e2e)', () => {
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

  const klimaProvider = (displayName?: string) =>
    providerIn(ctx, {
      categoryIds: [m.klimaId],
      districtIds: [m.seyhan, m.cukurova],
      ...(displayName ? { displayName } : {}),
    });

  /**
   * The Faz 3 demo, on real PostgreSQL: budget 1500 TL, the provider
   * offers 2500, the customer counters 2000, the provider counters 2200,
   * the customer accepts. The price is locked and the job exists.
   */
  it('runs the demo: 1500 budget → 2500 → 2000 → 2200 → accepted at 2200 TL', async () => {
    const customer = await customerIn(ctx, m.seyhan);
    const provider = await klimaProvider('Demo Klima Ustası');
    const other = await klimaProvider('Demo İkinci Usta');

    const request = await createRequest(ctx, customer, {
      categoryId: m.klimaId,
      budgetMinor: 150000,
    });
    expect(request.budget).toEqual({ amountMinor: 150000, currency: 'TRY' });

    // 1. Provider offers 2500 TL, over the budget: allowed.
    const offer = await createQuote(ctx, provider, request.id, 250000, {
      note: 'Montaj malzemeleri dahil.',
      materialsIncluded: true,
      estimatedDurationMinutes: 180,
    });
    expect(offer.status).toBe('PENDING_CUSTOMER');
    expect(offer.turn).toBe('CUSTOMER');
    expect(offer.provider.rating).toBeNull(); // "Yeni Usta", never a fake rating
    const rival = await createQuote(ctx, other, request.id, 240000);

    // Customer sees both quotes; the request moved to QUOTED.
    const mine = serviceRequestSchema.parse(
      (
        await ctx
          .http()
          .get(`/api/v1/service-requests/${request.id}`)
          .set('Authorization', bearer(customer))
          .expect(200)
      ).body,
    );
    expect(mine.status).toBe('QUOTED');
    expect(mine.quoteCount).toBe(2);

    // 2. Customer counters 2000 TL.
    const c1 = quoteSchema.parse(
      (await counter(ctx, customer, offer.id, 200000, 1).expect(200)).body,
    );
    expect(c1.status).toBe('PENDING_PROVIDER');
    expect(c1.turn).toBe('PROVIDER');
    expect(c1.latest).toMatchObject({ revisionNo: 2, kind: 'CUSTOMER_COUNTER', by: 'CUSTOMER' });

    // The customer cannot move twice in a row.
    const twice = await counter(ctx, customer, offer.id, 190000, 2).expect(409);
    expect(twice.body.code).toBe('NOT_YOUR_TURN');

    // 3. Provider counters 2200 TL.
    const c2 = quoteSchema.parse(
      (await counter(ctx, provider, offer.id, 220000, 2).expect(200)).body,
    );
    expect(c2.status).toBe('PENDING_CUSTOMER');
    expect(c2.latest).toMatchObject({ revisionNo: 3, kind: 'PROVIDER_COUNTER', by: 'PROVIDER' });
    // A provider counter keeps the offer's work details.
    expect(c2.latest.materialsIncluded).toBe(true);
    expect(c2.revisions.map((r) => r.total.amountMinor)).toEqual([250000, 200000, 220000]);

    // 4. Customer accepts.
    const accepted = quoteSchema.parse((await accept(ctx, customer, offer.id, 3).expect(200)).body);
    expect(accepted.status).toBe('ACCEPTED');
    expect(accepted.turn).toBeNull();
    expect(accepted.acceptedRevisionId).toBe(c2.latest.id);
    expect(accepted.jobId).not.toBeNull();

    // Request MATCHED, job with the locked price and the right parties.
    const req = await ctx.prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(req.status).toBe('MATCHED');
    expect(req.budgetMinor).toBe(150000n); // the budget itself never changes
    const job = await ctx.prisma.job.findUniqueOrThrow({
      where: { serviceRequestId: request.id },
      include: { customer: true },
    });
    expect(job.agreedPriceMinor).toBe(220000n);
    expect(job.currentTotalMinor).toBe(220000n);
    expect(job.currency).toBe('TRY');
    expect(job.status).toBe('CREATED');
    expect(job.providerId).toBe(provider.providerId);
    expect(job.customer.userId).toBe(customer.userId);
    expect(job.quoteId).toBe(offer.id);
    expect(job.acceptedRevisionId).toBe(c2.latest.id);

    // The other provider's quote is closed and they were told.
    const rivalRow = await ctx.prisma.quote.findUniqueOrThrow({ where: { id: rival.id } });
    expect(rivalRow.status).toBe('REJECTED');
    expect(
      await ctx.prisma.notification.count({
        where: { userId: other.userId, type: 'quote.rejected' },
      }),
    ).toBe(1);

    // Both parties see the job with the full address; each from their side.
    const asCustomer = jobSchema.parse(
      (
        await ctx
          .http()
          .get(`/api/v1/jobs/${job.id}`)
          .set('Authorization', bearer(customer))
          .expect(200)
      ).body,
    );
    expect(asCustomer.agreedPrice).toEqual({ amountMinor: 220000, currency: 'TRY' });
    expect(asCustomer.viewerRole).toBe('CUSTOMER');
    expect(asCustomer.provider.displayName).toBe('Demo Klima Ustası');
    const asProvider = jobSchema.parse(
      (
        await ctx
          .http()
          .get(`/api/v1/jobs/${job.id}`)
          .set('Authorization', bearer(provider))
          .expect(200)
      ).body,
    );
    expect(asProvider.viewerRole).toBe('PROVIDER');
    expect(asProvider.address.instructions).toBe('Kapı kodu 4321');
    // …and nobody else does.
    await ctx.http().get(`/api/v1/jobs/${job.id}`).set('Authorization', bearer(other)).expect(404);

    // The price is locked: no more moves on any quote of this request.
    expect((await counter(ctx, provider, offer.id, 230000, 3)).status).toBe(409);
    expect((await accept(ctx, customer, rival.id, 1)).status).toBe(409);
    const late = await klimaProvider();
    expect((await postQuote(ctx, late, request.id, { totalMinor: 100000 })).status).toBe(404);
    const edit = await ctx
      .http()
      .patch(`/api/v1/service-requests/${request.id}`)
      .set('Authorization', bearer(customer))
      .send({ budgetMinor: 100000 });
    expect(edit.status).toBe(409);
    const cancel = await ctx
      .http()
      .post(`/api/v1/service-requests/${request.id}/cancel`)
      .set('Authorization', bearer(customer))
      .send({});
    expect(cancel.status).toBe(409);

    // Revisions are immutable history: four moves in, three revisions stay.
    const revisions = await ctx.prisma.quoteRevision.findMany({
      where: { quoteId: offer.id },
      orderBy: { revisionNo: 'asc' },
    });
    expect(revisions.map((r) => r.totalMinor)).toEqual([250000n, 200000n, 220000n]);

    // Audit trail.
    const actions = (
      await ctx.prisma.auditLog.findMany({
        where: {
          OR: [
            { entityId: { in: [offer.id, rival.id, request.id, job.id] } },
            { metadata: { path: ['serviceRequestId'], equals: request.id } },
          ],
        },
        select: { action: true },
      })
    ).map((a) => a.action);
    for (const action of [
      'service_request.created',
      'quote.created',
      'quote.countered',
      'quote.accepted',
      'quote.rejected',
      'job.created',
    ]) {
      expect(actions).toContain(action);
    }
    // In-app notifications (no push was sent, and none is claimed).
    const providerNotes = await ctx.prisma.notification.findMany({
      where: { userId: provider.userId },
    });
    expect(providerNotes.map((n) => n.type)).toEqual(
      expect.arrayContaining(['quote.countered', 'quote.accepted']),
    );
    expect(providerNotes.every((n) => n.channel === 'IN_APP' && n.sentAt === null)).toBe(true);

    // Lists: customer "Taleplerim" AGREED, provider "Tekliflerim" ACCEPTED, "İşlerim".
    const agreed = await ctx
      .http()
      .get('/api/v1/me/service-requests?group=AGREED')
      .set('Authorization', bearer(customer))
      .expect(200);
    expect(agreed.body.items[0]).toMatchObject({
      id: request.id,
      agreedPrice: { amountMinor: 220000, currency: 'TRY' },
      jobId: job.id,
    });
    const provQuotes = paginatedSchema(providerQuoteListItemSchema).parse(
      (
        await ctx
          .http()
          .get('/api/v1/providers/me/quotes?filter=ACCEPTED')
          .set('Authorization', bearer(provider))
          .expect(200)
      ).body,
    );
    expect(provQuotes.items.map((q) => q.id)).toEqual([offer.id]);
    const jobs = await ctx
      .http()
      .get('/api/v1/jobs?role=PROVIDER')
      .set('Authorization', bearer(provider))
      .expect(200);
    expect(jobs.body.items.map((j: { id: string }) => j.id)).toEqual([job.id]);
  });

  it('lets the provider accept the customer’s counter', async () => {
    const customer = await customerIn(ctx, m.seyhan);
    const provider = await klimaProvider();
    const request = await createRequest(ctx, customer, {
      categoryId: m.klimaId,
      budgetMinor: null,
    });
    const offer = await createQuote(ctx, provider, request.id, 300000);
    await counter(ctx, customer, offer.id, 260000, 1).expect(200);

    // Customer cannot accept their own counter.
    const own = await accept(ctx, customer, offer.id, 2).expect(409);
    expect(own.body.code).toBe('NOT_YOUR_TURN');

    const done = quoteSchema.parse((await accept(ctx, provider, offer.id, 2).expect(200)).body);
    expect(done.status).toBe('ACCEPTED');
    const job = await ctx.prisma.job.findUniqueOrThrow({ where: { serviceRequestId: request.id } });
    expect(job.agreedPriceMinor).toBe(260000n);
  });

  it('accepts the first offer as is', async () => {
    const customer = await customerIn(ctx, m.seyhan);
    const provider = await klimaProvider();
    const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
    const offer = await createQuote(ctx, provider, request.id, 175050);
    await accept(ctx, customer, offer.id, 1).expect(200);
    const job = await ctx.prisma.job.findUniqueOrThrow({ where: { serviceRequestId: request.id } });
    expect(job.agreedPriceMinor).toBe(175050n);
  });

  describe('rules', () => {
    it('refuses a stale revision number', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const provider = await klimaProvider();
      const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
      const offer = await createQuote(ctx, provider, request.id, 250000);
      await counter(ctx, customer, offer.id, 200000, 1).expect(200);
      await counter(ctx, provider, offer.id, 220000, 2).expect(200);
      // The customer's screen still shows revision 2.
      const stale = await accept(ctx, customer, offer.id, 2).expect(409);
      expect(stale.body.code).toBe('QUOTE_REVISION_STALE');
    });

    it('refuses a counter at the same price', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const provider = await klimaProvider();
      const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
      const offer = await createQuote(ctx, provider, request.id, 250000);
      const same = await counter(ctx, customer, offer.id, 250000, 1).expect(422);
      expect(same.body.code).toBe('COUNTER_SAME_PRICE');
    });

    it('refuses a second quote from the same provider', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const provider = await klimaProvider();
      const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
      await createQuote(ctx, provider, request.id, 250000);
      const again = await postQuote(ctx, provider, request.id, { totalMinor: 240000 }).expect(409);
      expect(again.body.code).toBe('QUOTE_ALREADY_EXISTS');
    });

    it('validates money: integers in minor units, labour + material = total', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const provider = await klimaProvider();
      const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
      for (const body of [
        { totalMinor: 0 },
        { totalMinor: -5 },
        { totalMinor: 1500.5 },
        { totalMinor: '150000' },
        { totalMinor: 200000, laborMinor: 150000, materialMinor: 10000 },
      ]) {
        expect((await postQuote(ctx, provider, request.id, body)).status).toBe(400);
      }
      await postQuote(ctx, provider, request.id, {
        totalMinor: 200000,
        laborMinor: 150000,
        materialMinor: 50000,
      }).expect(201);
    });

    it('caps the negotiation at ten revisions', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const provider = await klimaProvider();
      const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
      const offer = await createQuote(ctx, provider, request.id, 300000);
      let rev = 1;
      for (; rev < 10; rev += 1) {
        const actor = rev % 2 === 1 ? customer : provider;
        await counter(ctx, actor, offer.id, 200000 + rev * 1000, rev).expect(200);
      }
      const actor = rev % 2 === 1 ? customer : provider;
      const res = await counter(ctx, actor, offer.id, 250000, rev).expect(422);
      expect(res.body.code).toBe('NEGOTIATION_LIMIT_REACHED');
      // Accepting the last price still works.
      await accept(ctx, actor, offer.id, rev).expect(200);
    });

    it('refuses an expired quote (validUntil)', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const provider = await klimaProvider();
      const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
      const offer = await createQuote(ctx, provider, request.id, 250000, {
        validUntil: new Date(Date.now() + 60_000).toISOString(),
      });
      await ctx.prisma.quoteRevision.updateMany({
        where: { quoteId: offer.id },
        data: { validUntil: new Date(Date.now() - 1000) },
      });
      const res = await accept(ctx, customer, offer.id, 1).expect(409);
      expect(res.body.code).toBe('QUOTE_EXPIRED');
    });

    it('stops a provider suspended mid-negotiation', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const provider = await klimaProvider();
      const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
      const offer = await createQuote(ctx, provider, request.id, 250000);
      await ctx.prisma.providerProfile.update({
        where: { id: provider.providerId },
        data: { status: 'SUSPENDED', statusReason: 'e2e askı' },
      });
      const res = await accept(ctx, customer, offer.id, 1).expect(409);
      expect(res.body.code).toBe('PROVIDER_NOT_ACTIVE');
      expect(await ctx.prisma.job.count({ where: { serviceRequestId: request.id } })).toBe(0);
    });
  });

  describe('closing without agreement', () => {
    it('customer rejects; the request returns to "open" when no quote is left', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const provider = await klimaProvider();
      const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
      const offer = await createQuote(ctx, provider, request.id, 250000);
      const res = await ctx
        .http()
        .post(`/api/v1/quotes/${offer.id}/reject`)
        .set('Authorization', bearer(customer))
        .send({ reason: 'Fiyat yüksek.' })
        .expect(200);
      expect(res.body.status).toBe('REJECTED');
      const req = await ctx.prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
      expect(req.status).toBe('PUBLISHED');
      // The provider cannot quote again on the same request.
      expect((await postQuote(ctx, provider, request.id, { totalMinor: 200000 })).status).toBe(409);
    });

    it('provider withdraws; only the provider may', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const provider = await klimaProvider();
      const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
      const offer = await createQuote(ctx, provider, request.id, 250000);
      const wrongSide = await ctx
        .http()
        .post(`/api/v1/quotes/${offer.id}/withdraw`)
        .set('Authorization', bearer(customer))
        .send({})
        .expect(403);
      expect(wrongSide.body.code).toBe('QUOTE_ACTION_FORBIDDEN');
      await ctx
        .http()
        .post(`/api/v1/quotes/${offer.id}/withdraw`)
        .set('Authorization', bearer(provider))
        .send({})
        .expect(200);
      expect((await accept(ctx, customer, offer.id, 1)).status).toBe(409);
    });
  });

  describe('privacy', () => {
    it('keeps a negotiation between its two parties (IDOR → 404)', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const provider = await klimaProvider();
      const other = await klimaProvider();
      const stranger = await customerIn(ctx, m.seyhan);
      const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
      const offer = await createQuote(ctx, provider, request.id, 250000);
      const theirs = await createQuote(ctx, other, request.id, 240000);

      for (const intruder of [other, stranger]) {
        await ctx
          .http()
          .get(`/api/v1/quotes/${offer.id}`)
          .set('Authorization', bearer(intruder))
          .expect(404);
        expect((await counter(ctx, intruder, offer.id, 100000, 1)).status).toBe(404);
        expect((await accept(ctx, intruder, offer.id, 1)).status).toBe(404);
        const reject = await ctx
          .http()
          .post(`/api/v1/quotes/${offer.id}/reject`)
          .set('Authorization', bearer(intruder))
          .send({});
        expect(reject.status).toBe(404);
      }
      // The other provider's list holds only their own thread.
      const list = await ctx
        .http()
        .get('/api/v1/providers/me/quotes')
        .set('Authorization', bearer(other))
        .expect(200);
      expect(list.body.items.map((q: { id: string }) => q.id)).toEqual([theirs.id]);
      // Only the customer lists all quotes of the request.
      await ctx
        .http()
        .get(`/api/v1/service-requests/${request.id}/quotes`)
        .set('Authorization', bearer(provider))
        .expect(404);
      const all = await ctx
        .http()
        .get(`/api/v1/service-requests/${request.id}/quotes`)
        .set('Authorization', bearer(customer))
        .expect(200);
      expect(all.body).toHaveLength(2);
    });

    it('shows no provider phone or e-mail on quote cards before agreement', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const provider = await klimaProvider();
      const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
      await createQuote(ctx, provider, request.id, 250000);
      const res = await ctx
        .http()
        .get(`/api/v1/service-requests/${request.id}/quotes`)
        .set('Authorization', bearer(customer))
        .expect(200);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('+90');
      expect(text).not.toContain('@');
    });
  });

  describe('NOW', () => {
    it('is a single quick quote: no counter, accept creates the job', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const fast = await providerIn(ctx, {
        categoryIds: [m.klimaId],
        districtIds: [m.seyhan],
        nowEnabled: true,
        isAvailableNow: true,
      });
      const slow = await providerIn(ctx, {
        categoryIds: [m.klimaId],
        districtIds: [m.seyhan],
        nowEnabled: true,
        isAvailableNow: true,
      });
      const request = await createRequest(ctx, customer, {
        type: 'NOW',
        categoryId: m.klimaId,
        budgetMinor: null,
      });
      expect(request.status).toBe('MATCHING');
      const quote = await createQuote(ctx, fast, request.id, 120000, {
        estimatedDurationMinutes: 45,
      });
      expect(quote.requestType).toBe('NOW');
      expect(quote.actions.counter).toBe(false);

      const noCounter = await counter(ctx, customer, quote.id, 100000, 1).expect(409);
      expect(noCounter.body.code).toBe('COUNTER_NOT_ALLOWED');

      await accept(ctx, customer, quote.id, 1).expect(200);
      const req = await ctx.prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
      expect(req.status).toBe('MATCHED');
      const job = await ctx.prisma.job.findUniqueOrThrow({
        where: { serviceRequestId: request.id },
      });
      expect(job.agreedPriceMinor).toBe(120000n);
      const offers = await ctx.prisma.emergencyDispatchOffer.findMany({
        where: { serviceRequestId: request.id },
      });
      expect(offers.find((o) => o.providerId === fast.providerId)?.status).toBe('ACCEPTED');
      expect(offers.find((o) => o.providerId === slow.providerId)?.status).toBe('SUPERSEDED');
      expect((await postQuote(ctx, slow, request.id, { totalMinor: 90000 })).status).toBe(404);
    });
  });
});
