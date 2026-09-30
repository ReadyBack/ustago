import { randomUUID } from 'node:crypto';

import {
  adminDispatchTimelineSchema,
  adminMatchPreviewSchema,
  categoryStatsSchema,
  marketplaceOverviewSchema,
  noOfferRequestRowSchema,
  paginatedSchema,
  regionStatsSchema,
} from '@ustago/validation';
import { z } from 'zod';

import {
  bearer,
  cleanup,
  createStaffUser,
  createTestApp,
  registerUser,
  resetRateLimits,
  type TestContext,
} from './helpers.js';
import {
  createQuote,
  createRequest,
  type Customer,
  customerIn,
  adanaMarket,
  type Market,
  providerIn,
} from './marketplace-helpers.js';

const API = '/api/v1';

describe('Admin marketplace analytics (e2e)', () => {
  let ctx: TestContext;
  let m: Market;
  let admin: string;
  let customerToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetRateLimits(ctx);
    m = await adanaMarket(ctx);
    admin = bearer(await createStaffUser(ctx, ['ADMIN']));
    customerToken = bearer(await registerUser(ctx));
  });

  afterAll(async () => {
    await m.restore();
    await cleanup(ctx);
    await ctx.app.close();
  });

  const get = (path: string, auth = admin) =>
    ctx.http().get(`${API}${path}`).set('Authorization', auth);

  /** Requests from several customers (the create rate limit is per customer). */
  async function requestsIn(districtId: string, n: number, categoryId = m.klimaId) {
    const ids: string[] = [];
    let customer: Customer | null = null;
    for (let i = 0; i < n; i += 1) {
      if (i % 3 === 0) customer = await customerIn(ctx, districtId);
      const r = await createRequest(ctx, customer as Customer, { categoryId });
      ids.push(r.id);
    }
    return ids;
  }

  describe('access', () => {
    const paths = [
      '/admin/marketplace/overview',
      '/admin/marketplace/regions',
      '/admin/marketplace/categories',
      '/admin/marketplace/no-offer',
      `/admin/marketplace/match-preview?requestId=${randomUUID()}`,
      `/admin/service-requests/${randomUUID()}/dispatch`,
    ];

    it.each(paths)('%s needs a token (401)', async (path) => {
      await ctx.http().get(`${API}${path}`).expect(401);
    });

    it.each(paths)('%s is staff only (403 for a customer)', async (path) => {
      await get(path, customerToken).expect(403);
    });

    it('validates queries (400)', async () => {
      await get('/admin/marketplace/overview?days=0').expect(400);
      await get('/admin/marketplace/regions?provinceId=82').expect(400);
      await get('/admin/marketplace/no-offer?cursor=not-a-uuid').expect(400);
      await get('/admin/marketplace/match-preview?requestId=nope').expect(400);
      await get('/admin/service-requests/nope/dispatch').expect(400);
    });

    it('404 for an unknown request', async () => {
      await get(`/admin/service-requests/${randomUUID()}/dispatch`).expect(404);
      await get(`/admin/marketplace/match-preview?requestId=${randomUUID()}`).expect(404);
    });
  });

  describe('overview', () => {
    it('returns real funnel counts that follow new requests and quotes', async () => {
      const before = marketplaceOverviewSchema.parse(
        (await get('/admin/marketplace/overview?days=7').expect(200)).body,
      );
      expect(before.periodDays).toBe(7);
      expect(before.funnel.map((s) => s.key)).toEqual([
        'created',
        'dispatched',
        'viewed',
        'quoted',
        'accepted',
        'started',
        'completed',
      ]);

      const customer = await customerIn(ctx, m.seyhan);
      const provider = await providerIn(ctx, {
        categoryIds: [m.klimaId],
        districtIds: [m.seyhan],
      });
      const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
      await createQuote(ctx, provider, request.id, 180000);

      const after = marketplaceOverviewSchema.parse(
        (await get('/admin/marketplace/overview?days=7').expect(200)).body,
      );
      const step = (o: typeof after, key: string) =>
        o.funnel.find((s) => s.key === key)?.requests ?? -1;
      expect(step(after, 'created')).toBe(step(before, 'created') + 1);
      expect(step(after, 'dispatched')).toBe(step(before, 'dispatched') + 1);
      expect(step(after, 'quoted')).toBe(step(before, 'quoted') + 1);
      expect(after.today.requestsCreated).toBeGreaterThanOrEqual(1);
      expect(after.today.quotes).toBeGreaterThanOrEqual(1);
      expect(after.activeProviders).toBeGreaterThanOrEqual(1);
      expect(after.availableProviders).toBeLessThanOrEqual(after.activeProviders);
      expect(after.quoteRatePercent).not.toBeNull();
      expect(after.medianFirstQuoteMinutes).not.toBeNull();
      // Each funnel step is a subset of the one before it.
      const counts = after.funnel.map((s) => s.requests);
      counts.slice(1).forEach((n, i) => expect(n).toBeLessThanOrEqual(counts[i] ?? 0));
    });
  });

  describe('regions', () => {
    it('lists provinces with their launch status', async () => {
      const rows = z
        .array(regionStatsSchema)
        .parse((await get('/admin/marketplace/regions?days=30').expect(200)).body);
      const adana = rows.find((r) => r.province.id === m.provinceId);
      expect(adana).toBeDefined();
      expect(adana?.district).toBeNull();
      expect(adana?.launchStatus).toBe('ACTIVE');
    });

    it('withholds numbers for districts with fewer than 5 requests', async () => {
      await requestsIn(m.yuregir, 2);
      await requestsIn(m.cukurova, 5);
      const rows = z
        .array(regionStatsSchema)
        .parse(
          (await get(`/admin/marketplace/regions?days=30&provinceId=${m.provinceId}`).expect(200))
            .body,
        );
      expect(rows.every((r) => r.province.id === m.provinceId && r.district !== null)).toBe(true);

      const small = rows.find((r) => r.district?.id === m.yuregir);
      expect(small).toBeDefined();
      expect(small?.requests).toBeNull();
      expect(small?.quotes).toBeNull();
      expect(small?.completedJobs).toBeNull();
      expect(small?.unservedRequests).toBeNull();
      expect(small?.demandPerProvider).toBeNull();

      const big = rows.find((r) => r.district?.id === m.cukurova);
      expect(big?.requests).toBeGreaterThanOrEqual(5);
      // Nobody serves Çukurova for these categories: none of the five were dispatched.
      const unserved = big?.unservedRequests;
      expect(unserved === null || (unserved ?? 0) >= 5).toBe(true);
    });

    it('district view of another province only has that province', async () => {
      const rows = z
        .array(regionStatsSchema)
        .parse((await get('/admin/marketplace/regions?provinceId=81').expect(200)).body);
      expect(rows.every((r) => r.province.id === 81 && r.district !== null)).toBe(true);
    });
  });

  describe('categories', () => {
    it('reports demand and supply per category, without a median below the sample', async () => {
      const rows = z
        .array(categoryStatsSchema)
        .parse((await get('/admin/marketplace/categories?days=30').expect(200)).body);
      const klima = rows.find((r) => r.category.id === m.klimaId);
      expect(klima).toBeDefined();
      expect(klima?.requests).toBeGreaterThanOrEqual(1);
      expect(klima?.activeProviders).toBeGreaterThanOrEqual(1);
      // No completed jobs in this run's categories: never a made-up price.
      expect(klima?.medianPriceMinor).toBeNull();
    });
  });

  describe('no-offer', () => {
    it('pages open requests without a quote, oldest first, by id cursor', async () => {
      const ids = await requestsIn(m.cukurova, 3, m.boyaId);
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 500; page += 1) {
        const query: string = `/admin/marketplace/no-offer?olderThanMinutes=0&limit=2${cursor ? `&cursor=${cursor}` : ''}`;
        const body = paginatedSchema(noOfferRequestRowSchema).parse(
          (await get(query).expect(200)).body,
        );
        expect(body.items.length).toBeLessThanOrEqual(2);
        seen.push(...body.items.map((i) => i.id));
        const mine = body.items.find((i) => i.id === ids[0]);
        if (mine) {
          expect(mine.category.id).toBe(m.boyaId);
          expect(mine.district.id).toBe(m.cukurova);
          expect(mine.dispatchedCount).toBe(0);
          expect(mine.ageMinutes).toBeGreaterThanOrEqual(0);
          expect(mine.publishedAt).not.toBeNull();
        }
        cursor = body.nextCursor;
        if (!cursor) break;
      }
      expect(new Set(seen).size).toBe(seen.length);
      expect([...seen].sort()).toEqual(seen);
      for (const id of ids) expect(seen).toContain(id);

      // Just published: not older than an hour yet.
      const hour = paginatedSchema(noOfferRequestRowSchema).parse(
        (await get('/admin/marketplace/no-offer?olderThanMinutes=60&limit=100').expect(200)).body,
      );
      expect(hour.items.map((i) => i.id)).not.toContain(ids[0]);
    });

    it('drops a request once it has a quote', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const provider = await providerIn(ctx, {
        categoryIds: [m.elektrikId],
        districtIds: [m.seyhan],
      });
      const request = await createRequest(ctx, customer, { categoryId: m.elektrikId });
      const listed = async () => {
        const ids: string[] = [];
        let cursor: string | null = null;
        do {
          const res = await get(
            `/admin/marketplace/no-offer?olderThanMinutes=0&limit=100${cursor ? `&cursor=${cursor}` : ''}`,
          ).expect(200);
          ids.push(...(res.body.items as { id: string }[]).map((i) => i.id));
          cursor = res.body.nextCursor as string | null;
        } while (cursor);
        return ids;
      };
      expect(await listed()).toContain(request.id);
      await createQuote(ctx, provider, request.id, 90000);
      expect(await listed()).not.toContain(request.id);
    });
  });

  describe('dispatch timeline and match preview', () => {
    it('shows the dispatch rows with the stored MATCH_V1 breakdown and events', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const provider = await providerIn(ctx, {
        categoryIds: [m.klimaId],
        districtIds: [m.seyhan],
        displayName: `Zaman Çizelgesi Ustası ${randomUUID().slice(0, 4)}`,
      });
      const request = await createRequest(ctx, customer, { categoryId: m.klimaId });

      const timeline = adminDispatchTimelineSchema.parse(
        (await get(`/admin/service-requests/${request.id}/dispatch`).expect(200)).body,
      );
      expect(timeline.requestId).toBe(request.id);
      expect(timeline.wave).toBeGreaterThanOrEqual(1);
      const row = timeline.rows.find((r) => r.providerId === provider.providerId);
      expect(row).toBeDefined();
      expect(row?.wave).toBe(1);
      expect(row?.algorithmVersion).toBe('MATCH_V1');
      expect(row?.providerName).toMatch(/^Zaman Çizelgesi Ustası/);
      expect(row?.breakdown.length).toBeGreaterThan(0);
      expect(row?.breakdown.some((l) => l.key === 'area')).toBe(true);
      expect(row?.result).toBe('PENDING');
      const types = timeline.events.map((e) => e.type);
      expect(types).toContain('request_created');
      expect(types).toContain('request_dispatched');

      await createQuote(ctx, provider, request.id, 120000);
      const afterQuote = adminDispatchTimelineSchema.parse(
        (await get(`/admin/service-requests/${request.id}/dispatch`).expect(200)).body,
      );
      expect(afterQuote.events.map((e) => e.type)).toContain('quote_created');
    });

    it('match preview ranks live candidates and writes nothing', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const first = await providerIn(ctx, {
        categoryIds: [m.klimaId],
        districtIds: [m.seyhan],
      });
      const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
      // Joins after publication: eligible now, but never dispatched.
      const late = await providerIn(ctx, {
        categoryIds: [m.klimaId],
        districtIds: [m.seyhan],
        displayName: 'Sonradan Katılan Usta',
      });

      const counts = () =>
        Promise.all([
          ctx.prisma.requestDispatch.count(),
          ctx.prisma.notification.count(),
          ctx.prisma.marketplaceEvent.count(),
          ctx.prisma.serviceRequest.findUniqueOrThrow({
            where: { id: request.id },
            select: { dispatchWave: true, nextDispatchAt: true, updatedAt: true, version: true },
          }),
        ]);
      const before = await counts();

      const preview = adminMatchPreviewSchema.parse(
        (await get(`/admin/marketplace/match-preview?requestId=${request.id}`).expect(200)).body,
      );
      expect(preview.requestId).toBe(request.id);
      expect(preview.algorithmVersion).toBe('MATCH_V1');
      expect(preview.durationMs).toBeGreaterThanOrEqual(0);
      const a = preview.candidates.find((c) => c.providerId === first.providerId);
      const b = preview.candidates.find((c) => c.providerId === late.providerId);
      expect(a?.alreadyDispatched).toBe(true);
      expect(b?.alreadyDispatched).toBe(false);
      expect(b?.providerName).toBe('Sonradan Katılan Usta');
      expect(b?.breakdown.length).toBeGreaterThan(0);
      // Best first.
      const scores = preview.candidates.map((c) => c.score);
      expect([...scores].sort((x, y) => y - x)).toEqual(scores);

      expect(await counts()).toEqual(before);
    });
  });
});
