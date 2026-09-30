import {
  adminDashboardStatsSchema,
  adminServiceRequestDetailSchema,
  adminServiceRequestListItemSchema,
  adminSystemStatusSchema,
  paginatedSchema,
} from '@ustago/validation';

import {
  bearer,
  cleanup,
  createStaffUser,
  createTestApp,
  resetRateLimits,
  type TestContext,
} from './helpers.js';
import {
  accept,
  adanaMarket,
  createQuote,
  createRequest,
  customerIn,
  type Market,
  providerIn,
} from './marketplace-helpers.js';

describe('Admin marketplace views (e2e)', () => {
  let ctx: TestContext;
  let m: Market;
  let admin: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetRateLimits(ctx);
    m = await adanaMarket(ctx);
    admin = bearer(await createStaffUser(ctx, ['ADMIN']));
  });

  afterAll(async () => {
    await m.restore();
    await cleanup(ctx);
    await ctx.app.close();
  });

  const get = (path: string, auth = admin) =>
    ctx.http().get(`/api/v1/admin${path}`).set('Authorization', auth);

  it('keeps every route behind the ADMIN role', async () => {
    const customer = await customerIn(ctx, m.seyhan);
    const provider = await providerIn(ctx, { categoryIds: [m.klimaId], districtIds: [m.seyhan] });
    const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
    for (const path of [
      '/stats',
      '/service-requests',
      `/service-requests/${request.id}`,
      '/system-status',
    ]) {
      expect((await get(path, bearer(customer))).status).toBe(403);
      expect((await get(path, bearer(provider))).status).toBe(403);
      expect((await ctx.http().get(`/api/v1/admin${path}`)).status).toBe(401);
    }
  });

  it('counts real rows on the dashboard', async () => {
    const before = adminDashboardStatsSchema.parse((await get('/stats').expect(200)).body);
    expect(before.timeZone).toBe('Europe/Istanbul');

    const customer = await customerIn(ctx, m.seyhan);
    const provider = await providerIn(ctx, { categoryIds: [m.klimaId], districtIds: [m.seyhan] });
    await providerIn(ctx, {
      categoryIds: [m.klimaId],
      districtIds: [m.seyhan],
      status: 'PENDING_REVIEW',
    });
    const open = await createRequest(ctx, customer, { categoryId: m.klimaId });
    const agreed = await createRequest(ctx, customer, { categoryId: m.klimaId });
    const quote = await createQuote(ctx, provider, agreed.id, 200000);
    await accept(ctx, customer, quote.id, 1).expect(200);

    const after = adminDashboardStatsSchema.parse((await get('/stats').expect(200)).body);
    expect(after.totalUsers - before.totalUsers).toBe(3);
    expect(after.activeProviders - before.activeProviders).toBe(1);
    expect(after.pendingProviders - before.pendingProviders).toBe(1);
    expect(after.openServiceRequests - before.openServiceRequests).toBe(1);
    expect(after.newServiceRequestsToday - before.newServiceRequestsToday).toBe(2);
    expect(after.jobsCreated - before.jobsCreated).toBe(1);
    expect(open.status).toBe('PUBLISHED');
  });

  it('lists and filters service requests, and shows a masked detail', async () => {
    const customer = await customerIn(ctx, m.cukurova);
    const provider = await providerIn(ctx, {
      categoryIds: [m.elektrikId],
      districtIds: [m.cukurova],
    });
    const request = await createRequest(ctx, customer, {
      categoryId: m.elektrikId,
      title: 'Sigorta sürekli atıyor',
      budgetMinor: null,
    });
    await createQuote(ctx, provider, request.id, 90000);

    const list = paginatedSchema(adminServiceRequestListItemSchema).parse(
      (
        await get(
          `/service-requests?status=QUOTED&type=QUOTE&provinceId=${m.provinceId}&categoryId=${m.elektrikId}`,
        ).expect(200)
      ).body,
    );
    expect(list.items.map((r) => r.id)).toEqual([request.id]);
    expect(list.items[0]?.quoteCount).toBe(1);
    expect(list.items[0]?.budget).toBeNull();

    const none = await get(`/service-requests?status=MATCHED&categoryId=${m.elektrikId}`).expect(
      200,
    );
    expect(none.body.items).toEqual([]);

    const detail = adminServiceRequestDetailSchema.parse(
      (await get(`/service-requests/${request.id}`).expect(200)).body,
    );
    expect(detail.quotes).toHaveLength(1);
    expect(detail.quotes[0]?.revisions.at(-1)?.total.amountMinor).toBe(90000);
    expect(detail.location.neighborhood).toBe('Reşatbey Mah.');
    expect(detail.customer.maskedPhone).toMatch(/\*/);
    const text = JSON.stringify(detail);
    expect(text).not.toContain('Atatürk Caddesi');
    expect(text).not.toContain('Kapı kodu');

    await get('/service-requests?status=BOGUS').expect(400);
    await get('/service-requests/00000000-0000-7000-8000-000000000000').expect(404);
  });

  it('reports system status without secrets', async () => {
    const res = await get('/system-status').expect(200);
    const status = adminSystemStatusSchema.parse(res.body);
    expect(status.database).toBe('up');
    expect(status.redis).toBe('up');
    const text = JSON.stringify(res.body);
    for (const key of ['JWT', 'SECRET', 'PASSWORD', 'postgres://', 'postgresql://', 'redis://']) {
      expect(text.toUpperCase()).not.toContain(key.toUpperCase());
    }
  });
});
