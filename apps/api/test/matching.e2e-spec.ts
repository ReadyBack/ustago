import { opportunitySchema } from '@ustago/validation';

import { bearer, cleanup, createTestApp, resetRateLimits, type TestContext } from './helpers.js';
import {
  adanaMarket,
  createRequest,
  customerIn,
  type Market,
  opportunities,
  opportunityIds,
  postQuote,
  providerIn,
} from './marketplace-helpers.js';

/**
 * Matching: every rule is checked on every read and on every write, so a
 * provider sees exactly the requests they may quote on, and a guessed id
 * behaves like a missing one.
 */
describe('Matching and the opportunity feed (e2e)', () => {
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

  it('shows a published request to a provider with the category and district', async () => {
    const customer = await customerIn(ctx, m.seyhan);
    const provider = await providerIn(ctx, { categoryIds: [m.klimaId], districtIds: [m.seyhan] });
    const request = await createRequest(ctx, customer, { categoryId: m.klimaId });

    const feed = await opportunities(ctx, provider);
    const item = feed.find((o) => o.id === request.id);
    expect(item).toBeDefined();
    const parsed = opportunitySchema.parse(item);
    expect(parsed.location.district.id).toBe(m.seyhan);
    expect(parsed.budget).toEqual({ amountMinor: 150000, currency: 'TRY' });
    expect(parsed.myQuoteId).toBeNull();
  });

  it('never reveals the address, customer name or phone before agreement', async () => {
    const customer = await customerIn(ctx, m.seyhan);
    const provider = await providerIn(ctx, { categoryIds: [m.klimaId], districtIds: [m.seyhan] });
    const request = await createRequest(ctx, customer, { categoryId: m.klimaId });

    const res = await ctx
      .http()
      .get(`/api/v1/providers/me/opportunities/${request.id}`)
      .set('Authorization', bearer(provider))
      .expect(200);
    const text = JSON.stringify(res.body);
    for (const secret of ['Atatürk Caddesi', 'Kapı kodu', '4321', 'Müşteri', '+90']) {
      expect(text).not.toContain(secret);
    }
    expect(res.body).not.toHaveProperty('address');
    expect(res.body).not.toHaveProperty('customer');
  });

  describe('excludes', () => {
    it('providers of another category', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const provider = await providerIn(ctx, {
        categoryIds: [m.elektrikId],
        districtIds: [m.seyhan],
      });
      const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
      expect(await opportunityIds(ctx, provider)).not.toContain(request.id);
    });

    it('providers of another district', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const provider = await providerIn(ctx, {
        categoryIds: [m.klimaId],
        districtIds: [m.cukurova],
      });
      const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
      expect(await opportunityIds(ctx, provider)).not.toContain(request.id);
    });

    it.each(['PENDING_REVIEW', 'SUSPENDED', 'DRAFT'] as const)('%s providers', async (status) => {
      const customer = await customerIn(ctx, m.seyhan);
      const provider = await providerIn(ctx, {
        categoryIds: [m.klimaId],
        districtIds: [m.seyhan],
        status,
      });
      const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
      const res = await ctx
        .http()
        .get('/api/v1/providers/me/opportunities')
        .set('Authorization', bearer(provider));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PROVIDER_NOT_ACTIVE');
      const quote = await postQuote(ctx, provider, request.id, { totalMinor: 200000 });
      expect(quote.status).toBe(403);
    });

    it('the provider’s own request', async () => {
      const provider = await providerIn(ctx, { categoryIds: [m.klimaId], districtIds: [m.seyhan] });
      // The provider also books a service as a customer, from their own address.
      const res = await ctx
        .http()
        .post('/api/v1/me/addresses')
        .set('Authorization', bearer(provider))
        .send({
          provinceId: m.provinceId,
          districtId: m.seyhan,
          addressLine: 'Kendi evim, No: 3',
        })
        .expect(201);
      const own = await createRequest(
        ctx,
        { ...provider, addressId: res.body.id },
        { categoryId: m.klimaId },
      );
      expect(await opportunityIds(ctx, provider)).not.toContain(own.id);
      expect((await postQuote(ctx, provider, own.id, { totalMinor: 200000 })).status).toBe(404);
    });

    it('closed, cancelled and expired requests', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const provider = await providerIn(ctx, { categoryIds: [m.klimaId], districtIds: [m.seyhan] });
      const cancelled = await createRequest(ctx, customer, { categoryId: m.klimaId });
      await ctx
        .http()
        .post(`/api/v1/service-requests/${cancelled.id}/cancel`)
        .set('Authorization', bearer(customer))
        .send({})
        .expect(200);
      const expired = await createRequest(ctx, customer, { categoryId: m.klimaId });
      await ctx.prisma.serviceRequest.update({
        where: { id: expired.id },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });
      const ids = await opportunityIds(ctx, provider);
      expect(ids).not.toContain(cancelled.id);
      expect(ids).not.toContain(expired.id);
    });

    it('everything once a category or province is switched off, without touching providers', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const provider = await providerIn(ctx, {
        categoryIds: [m.elektrikId],
        districtIds: [m.seyhan],
      });
      const request = await createRequest(ctx, customer, { categoryId: m.elektrikId });
      expect(await opportunityIds(ctx, provider)).toContain(request.id);

      await ctx.prisma.serviceCategory.update({
        where: { id: m.elektrikId },
        data: { isActive: false },
      });
      expect(await opportunityIds(ctx, provider)).not.toContain(request.id);
      await ctx.prisma.serviceCategory.update({
        where: { id: m.elektrikId },
        data: { isActive: true },
      });

      await ctx.prisma.provinceCategory.create({
        data: { provinceId: m.provinceId, categoryId: m.elektrikId, isActive: false },
      });
      expect(await opportunityIds(ctx, provider)).not.toContain(request.id);
      await ctx.prisma.provinceCategory.deleteMany({
        where: { provinceId: m.provinceId, categoryId: m.elektrikId },
      });
      expect(await opportunityIds(ctx, provider)).toContain(request.id);
    });

    it('requests the provider already quoted on (they live in "Tekliflerim")', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const provider = await providerIn(ctx, { categoryIds: [m.klimaId], districtIds: [m.seyhan] });
      const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
      await postQuote(ctx, provider, request.id, { totalMinor: 200000 }).expect(201);
      expect(await opportunityIds(ctx, provider)).not.toContain(request.id);
      // The detail stays readable, with the provider's own quote id.
      const res = await ctx
        .http()
        .get(`/api/v1/providers/me/opportunities/${request.id}`)
        .set('Authorization', bearer(provider))
        .expect(200);
      expect(res.body.myQuoteId).not.toBeNull();
    });
  });

  describe('NOW (acil)', () => {
    async function nowRequest(categoryId = m.klimaId) {
      const customer = await customerIn(ctx, m.seyhan);
      return {
        customer,
        request: await createRequest(ctx, customer, { type: 'NOW', categoryId }),
      };
    }

    it('reaches only NOW-enabled providers who are available right now', async () => {
      const ready = await providerIn(ctx, {
        categoryIds: [m.klimaId],
        districtIds: [m.seyhan],
        nowEnabled: true,
        isAvailableNow: true,
      });
      const notAvailable = await providerIn(ctx, {
        categoryIds: [m.klimaId],
        districtIds: [m.seyhan],
        nowEnabled: true,
        isAvailableNow: false,
      });
      const notNow = await providerIn(ctx, {
        categoryIds: [m.klimaId],
        districtIds: [m.seyhan],
        nowEnabled: false,
      });
      const otherDistrict = await providerIn(ctx, {
        categoryIds: [m.klimaId],
        districtIds: [m.cukurova],
        nowEnabled: true,
        isAvailableNow: true,
      });
      const { request } = await nowRequest();
      expect(request.status).toBe('MATCHING');

      const feed = await opportunities(ctx, ready, '?type=NOW');
      expect(feed.map((o) => o.id)).toContain(request.id);
      expect(feed.find((o) => o.id === request.id)?.type).toBe('NOW');
      for (const p of [notAvailable, notNow, otherDistrict]) {
        expect(await opportunityIds(ctx, p)).not.toContain(request.id);
      }

      // Dispatch offers and "new emergency" notifications went to the ready provider only.
      const offers = await ctx.prisma.emergencyDispatchOffer.findMany({
        where: { serviceRequestId: request.id },
      });
      expect(offers.map((o) => o.providerId)).toEqual([ready.providerId]);
      expect(
        await ctx.prisma.notification.count({
          where: { userId: ready.userId, type: 'now.new_request' },
        }),
      ).toBe(1);
      expect(
        await ctx.prisma.auditLog.count({
          where: { entityId: request.id, action: 'now.request_created' },
        }),
      ).toBe(1);
    });

    it('drops out of the feed the moment the provider turns "Müsaitim" off', async () => {
      const provider = await providerIn(ctx, {
        categoryIds: [m.klimaId],
        districtIds: [m.seyhan],
        nowEnabled: true,
        isAvailableNow: true,
      });
      const { request } = await nowRequest();
      expect(await opportunityIds(ctx, provider)).toContain(request.id);
      await ctx.prisma.providerProfile.update({
        where: { id: provider.providerId },
        data: { isAvailableNow: false },
      });
      expect(await opportunityIds(ctx, provider)).not.toContain(request.id);
      expect((await postQuote(ctx, provider, request.id, { totalMinor: 90000 })).status).toBe(404);
    });

    it('respects a province × category NOW switch-off for existing requests', async () => {
      const provider = await providerIn(ctx, {
        categoryIds: [m.elektrikId],
        districtIds: [m.seyhan],
        nowEnabled: true,
        isAvailableNow: true,
      });
      const { request } = await nowRequest(m.elektrikId);
      expect(await opportunityIds(ctx, provider)).toContain(request.id);
      await ctx.prisma.provinceCategory.create({
        data: {
          provinceId: m.provinceId,
          categoryId: m.elektrikId,
          isActive: true,
          nowEnabled: false,
        },
      });
      try {
        expect(await opportunityIds(ctx, provider)).not.toContain(request.id);
      } finally {
        await ctx.prisma.provinceCategory.deleteMany({
          where: { provinceId: m.provinceId, categoryId: m.elektrikId },
        });
      }
    });
  });

  describe('guessed ids', () => {
    it('return 404 for a request the provider may not see', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const outsider = await providerIn(ctx, {
        categoryIds: [m.klimaId],
        districtIds: [m.yuregir],
      });
      const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
      const detail = await ctx
        .http()
        .get(`/api/v1/providers/me/opportunities/${request.id}`)
        .set('Authorization', bearer(outsider));
      expect(detail.status).toBe(404);
      expect(detail.body.code).toBe('OPPORTUNITY_NOT_FOUND');
      const quote = await postQuote(ctx, outsider, request.id, { totalMinor: 200000 });
      expect(quote.status).toBe(404);
      expect(quote.body.code).toBe('OPPORTUNITY_NOT_FOUND');
    });

    it('customers cannot read the provider feed at all', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      await ctx
        .http()
        .get('/api/v1/providers/me/opportunities')
        .set('Authorization', bearer(customer))
        .expect(403);
    });
  });

  it('paginates with a cursor', async () => {
    const customer = await customerIn(ctx, m.cukurova);
    const provider = await providerIn(ctx, {
      categoryIds: [m.boyaId],
      districtIds: [m.cukurova],
    });
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push((await createRequest(ctx, customer, { categoryId: m.boyaId })).id);
    }
    const page1 = await ctx
      .http()
      .get('/api/v1/providers/me/opportunities?limit=2')
      .set('Authorization', bearer(provider))
      .expect(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).not.toBeNull();
    const page2 = await ctx
      .http()
      .get(`/api/v1/providers/me/opportunities?limit=2&cursor=${page1.body.nextCursor}`)
      .set('Authorization', bearer(provider))
      .expect(200);
    const seen = [...page1.body.items, ...page2.body.items].map((o: { id: string }) => o.id);
    expect(seen.sort()).toEqual([...ids].sort());
  });
});
