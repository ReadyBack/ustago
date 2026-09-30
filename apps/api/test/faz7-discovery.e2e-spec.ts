import { randomUUID } from 'node:crypto';

import type { ProviderCard } from '@ustago/types';
import {
  customerHomeSchema,
  favoriteProviderSchema,
  paginatedSchema,
  providerCardSchema,
  searchResultSchema,
} from '@ustago/validation';

import { DiscoveryService } from '../src/discovery/discovery.service.js';
import { seedCategoryContent } from '../src/seed/seed-category-content.js';
import {
  createRequestV2,
  districtId,
  newCategory,
  patchAvailability,
  setCoverage,
  setRegions,
} from './faz7-helpers.js';
import {
  bearer,
  cleanup,
  createStaffUser,
  createTestApp,
  phoneLogin,
  resetRateLimits,
  type TestContext,
} from './helpers.js';
import { agreedJob, completedJob } from './job-helpers.js';
import {
  adanaMarket,
  createQuote,
  createRequest,
  customerIn,
  type Market,
  type ProviderActor,
  providerIn,
} from './marketplace-helpers.js';
import { asActor, type Actor } from './provider-helpers.js';

const cardPage = paginatedSchema(providerCardSchema);
const favoritePage = paginatedSchema(favoriteProviderSchema);

/**
 * Faz 7 customer discovery: category search with Turkish normalisation and
 * typo tolerance, popular categories from real data only, provider
 * listing, favorites and the customer home.
 */
describe('Faz 7: discovery, favorites and home (e2e)', () => {
  let ctx: TestContext;
  let m: Market;
  let admin: Actor;
  let kozan: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetRateLimits(ctx);
    // Aliases and questions of the seeded categories (the dev seed does this too).
    await seedCategoryContent(ctx.prisma);
    m = await adanaMarket(ctx);
    admin = asActor(await createStaffUser(ctx, ['ADMIN']));
    kozan = await districtId(ctx, m.provinceId, 'kozan');
  });

  afterAll(async () => {
    await m.restore();
    await cleanup(ctx);
    await ctx.app.close();
  });

  describe('search', () => {
    async function search(q: string) {
      const res = await ctx.http().get('/api/v1/search').query({ q }).expect(200);
      return searchResultSchema.parse(res.body);
    }

    it.each([
      ['elektirikçi', 'elektrik'],
      ['elektrk', 'elektrik'],
      ['ELEKTRİKÇİ', 'elektrik'],
      ['tesisatci', 'su-tesisati'],
      ['su kaçağı', 'su-tesisati'],
      ['KLİMA', 'klima'],
      ['klimaci', 'klima'],
      ['sigorta attı', 'elektrik'],
      ['boyacı', 'boya-badana'],
      ['cilingir', 'cilingir'],
    ])('"%s" finds %s', async (q, slug) => {
      const result = await search(q);
      expect(result.noResult).toBe(false);
      expect(result.query).toBe(q);
      // Run-owned test categories ("Elektrik e2e-...") may match too; among the
      // catalogue categories the expected one comes first.
      const catalogue = result.categories.filter((c) => !c.category.slug.startsWith('e2e-'));
      expect(catalogue[0]?.category.slug).toBe(slug);
      expect(result.suggestions).toEqual([]);
    });

    it('names the kind of match', async () => {
      expect((await search('klima')).categories[0]?.matchKind).toBe('NAME');
      expect((await search('tesisatçı')).categories[0]?.matchKind).toBe('ALIAS');
      expect((await search('çilin')).categories[0]).toMatchObject({
        matchKind: 'PREFIX',
        category: { slug: 'cilingir' },
      });
      const fuzzy = (await search('elektirik')).categories.filter(
        (c) => !c.category.slug.startsWith('e2e-'),
      );
      expect(fuzzy[0]).toMatchObject({
        matchKind: 'FUZZY',
        category: { slug: 'elektrik' },
      });
    });

    it('returns suggestions instead of guessing when nothing matches', async () => {
      const result = await search('zzqxw vbnm');
      expect(result.noResult).toBe(true);
      expect(result.categories).toEqual([]);
      expect(result.suggestions.length).toBeGreaterThan(0);
      const events = await ctx.prisma.marketplaceEvent.findMany({
        where: { type: 'search_no_result', occurredAt: { gte: new Date(Date.now() - 60_000) } },
      });
      expect(events.length).toBeGreaterThan(0);
    });

    it('never stores personal data from the query', async () => {
      const since = new Date();
      await search('klima 05321234567 ahmet@example.com');
      await search('elektrik 05321234567');
      const events = await ctx.prisma.marketplaceEvent.findMany({
        where: { occurredAt: { gte: since } },
      });
      const text = JSON.stringify(events.map((e) => e.metadata));
      expect(text).not.toContain('05321234567');
      expect(text).not.toContain('example.com');
    });

    it('validates the query and records clicks', async () => {
      await ctx.http().get('/api/v1/search').query({ q: '' }).expect(400);
      await ctx
        .http()
        .get('/api/v1/search')
        .query({ q: 'x'.repeat(81) })
        .expect(400);
      const klima = await ctx.prisma.serviceCategory.findUniqueOrThrow({
        where: { slug: 'klima' },
      });
      await ctx
        .http()
        .post('/api/v1/search/click')
        .send({ categoryId: klima.id, query: 'klimaci' })
        .expect(204);
      await ctx.http().post('/api/v1/search/click').send({ categoryId: 'klima' }).expect(400);
      const clicks = await ctx.prisma.marketplaceEvent.count({
        where: { type: 'search_category_clicked', categoryId: klima.id },
      });
      expect(clicks).toBeGreaterThanOrEqual(1);
    });
  });

  describe('popular categories', () => {
    async function popular(provinceId: number) {
      const res = await ctx
        .http()
        .get('/api/v1/categories/popular')
        .query({ provinceId })
        .expect(200);
      return (res.body as { id: string }[]).map((c) => c.id);
    }

    it('are empty where there is not enough real data', async () => {
      const DUZCE = 81;
      const requests = await ctx.prisma.serviceRequest.count({ where: { provinceId: DUZCE } });
      expect(requests).toBe(0);
      expect(await popular(DUZCE)).toEqual([]);
    });

    it('appear only once the minimum number of published requests is reached', async () => {
      const categoryId = await newCategory(ctx);
      const draftOnly = await newCategory(ctx);
      const customer = await customerIn(ctx, m.seyhan);
      // Drafts never count.
      for (let i = 0; i < 3; i += 1) {
        await createRequest(ctx, customer, { categoryId: draftOnly, publish: false });
      }
      for (let i = 0; i < 2; i += 1) await createRequestV2(ctx, customer, { categoryId });
      let ids = await popular(m.provinceId);
      expect(ids).not.toContain(categoryId);
      expect(ids).not.toContain(draftOnly);

      await createRequestV2(ctx, customer, { categoryId });
      // The search catalogue (60 s cache) must know the new category.
      ctx.app.get(DiscoveryService).invalidateCatalog();
      ids = await popular(m.provinceId);
      expect(ids).toContain(categoryId);
      expect(ids).not.toContain(draftOnly);
      // Other provinces are unaffected.
      expect(await popular(81)).toEqual([]);
    });
  });

  describe('provider listing', () => {
    let categoryId: string;
    let near: ProviderActor;
    let farther: ProviderActor;
    let paused: ProviderActor;
    let regional: ProviderActor;
    let suspended: ProviderActor;
    let accountSuspended: ProviderActor;
    let restricted: ProviderActor;
    let elsewhere: ProviderActor;

    beforeAll(async () => {
      categoryId = await newCategory(ctx);
      const make = (districtIds: string[], extra: object = {}) =>
        providerIn(ctx, { categoryIds: [categoryId], districtIds, ...extra });
      near = await make([m.seyhan]);
      await setCoverage(ctx, near, { serviceCenterDistrictId: m.seyhan }).expect(200);
      farther = await make([m.seyhan, m.cukurova]);
      await setCoverage(ctx, farther, { serviceCenterDistrictId: m.cukurova }).expect(200);
      paused = await make([m.seyhan]);
      await patchAvailability(ctx, paused, { acceptingNewJobs: false }).expect(200);
      regional = await make([]);
      await setRegions(ctx, regional, [{ kind: 'PROVINCE', provinceId: m.provinceId }]).expect(200);
      suspended = await make([m.seyhan], { status: 'SUSPENDED' });
      accountSuspended = await make([m.seyhan]);
      await ctx.prisma.providerProfile.update({
        where: { id: accountSuspended.providerId },
        data: { accountStatus: 'SUSPENDED' },
      });
      restricted = await make([m.seyhan]);
      await ctx
        .http()
        .post(`/api/v1/admin/providers/${restricted.providerId}/penalties`)
        .set('Authorization', bearer(admin))
        .send({
          type: 'JOB_RESTRICTION',
          reasonCode: 'QUALITY_REVIEW',
          reason: 'Kalite incelemesi sürerken yeni iş alamaz.',
          endsAt: new Date(Date.now() + 86400_000).toISOString(),
        })
        .expect(201);
      elsewhere = await make([kozan]);
    });

    async function list(query: Record<string, string | number | boolean>, auth?: Actor) {
      const req = ctx.http().get('/api/v1/providers').query(query);
      if (auth) req.set('Authorization', bearer(auth));
      const res = await req.expect(200);
      return cardPage.parse(res.body);
    }

    async function listAll(query: Record<string, string | number | boolean>, auth?: Actor) {
      const items: ProviderCard[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 20; i += 1) {
        const page = await list({ ...query, ...(cursor ? { cursor } : {}) }, auth);
        items.push(...(page.items as ProviderCard[]));
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      return items;
    }

    it('lists only publicly listed providers covering the district', async () => {
      const items = await listAll({ categoryId, districtId: m.seyhan, limit: 2 });
      const ids = items.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect([...ids].sort()).toEqual(
        [near, farther, paused, regional].map((p) => p.providerId).sort(),
      );
      for (const p of [suspended, accountSuspended, restricted, elsewhere]) {
        expect(ids).not.toContain(p.providerId);
      }
      // No contact data on cards.
      const text = JSON.stringify(items);
      expect(text).not.toMatch(/\+90|@ustago\.test|phone|email/);
    });

    it('sorts by approximate distance and filters "bugün müsait"', async () => {
      const nearest = await listAll({ categoryId, districtId: m.seyhan, sort: 'NEAREST' });
      expect(nearest[0]?.id).toBe(near.providerId);
      expect(nearest[0]?.distance).toEqual({ km: 1, approximate: true });
      expect(nearest[1]?.id).toBe(farther.providerId);
      expect(nearest.slice(2).every((c) => c.distance === null)).toBe(true);

      const today = (await listAll({ categoryId, districtId: m.seyhan, availableToday: true })).map(
        (c) => c.id,
      );
      expect(today).not.toContain(paused.providerId);
      expect(today).toContain(near.providerId);

      const within5 = (await listAll({ categoryId, districtId: m.seyhan, maxDistanceKm: 5 })).map(
        (c) => c.id,
      );
      expect(within5).toEqual([near.providerId]);
    });

    it('favorites are idempotent, private to the customer and only for listed providers', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const put = (id: string, who: Actor = customer) =>
        ctx.http().put(`/api/v1/me/favorites/${id}`).set('Authorization', bearer(who));
      const del = (id: string) =>
        ctx.http().delete(`/api/v1/me/favorites/${id}`).set('Authorization', bearer(customer));
      const favorites = async () => {
        const res = await ctx
          .http()
          .get('/api/v1/me/favorites')
          .set('Authorization', bearer(customer))
          .expect(200);
        return favoritePage.parse(res.body);
      };

      await put(near.providerId).expect(204);
      await put(near.providerId).expect(204);
      let favs = await favorites();
      expect(favs.items.map((f) => f.provider.id)).toEqual([near.providerId]);
      expect(favs.items[0]).toMatchObject({ available: true, unavailableReason: null });
      expect(favs.items[0]?.provider.isFavorite).toBe(true);
      expect(
        await ctx.prisma.marketplaceEvent.count({
          where: { type: 'provider_favorited', providerId: near.providerId },
        }),
      ).toBe(1);
      const listed = await listAll({ categoryId, districtId: m.seyhan }, customer);
      expect(listed.find((c) => c.id === near.providerId)?.isFavorite).toBe(true);
      expect(listed.find((c) => c.id === farther.providerId)?.isFavorite).toBe(false);

      for (const p of [suspended, accountSuspended]) {
        const res = await put(p.providerId);
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('PROVIDER_NOT_FOUND');
      }
      expect((await put(randomUUID())).status).toBe(404);
      expect((await put('not-a-uuid')).status).toBe(400);
      await ctx.http().put(`/api/v1/me/favorites/${near.providerId}`).expect(401);

      await del(near.providerId).expect(204);
      await del(near.providerId).expect(204);
      favs = await favorites();
      expect(favs.items).toEqual([]);

      // A provider cannot favourite their own profile.
      const own = await put(near.providerId, near);
      expect(own.status).toBe(404);
    });

    it('a favourite who gets suspended is shown as unavailable, and hidden from listing and home', async () => {
      const provider = await providerIn(ctx, {
        categoryIds: [categoryId],
        districtIds: [m.seyhan],
      });
      const customer = await customerIn(ctx, m.seyhan);
      await ctx
        .http()
        .put(`/api/v1/me/favorites/${provider.providerId}`)
        .set('Authorization', bearer(customer))
        .expect(204);
      await ctx.prisma.providerProfile.update({
        where: { id: provider.providerId },
        data: { accountStatus: 'SUSPENDED' },
      });
      const res = await ctx
        .http()
        .get('/api/v1/me/favorites')
        .set('Authorization', bearer(customer))
        .expect(200);
      const favs = favoritePage.parse(res.body);
      expect(favs.items[0]).toMatchObject({ available: false, unavailableReason: 'SUSPENDED' });
      const home = await ctx
        .http()
        .get('/api/v1/me/home')
        .set('Authorization', bearer(customer))
        .expect(200);
      const parsed = customerHomeSchema.parse(home.body);
      expect(parsed.favorites.map((c) => c.id)).not.toContain(provider.providerId);
      expect(parsed.nearbyProviders.map((c) => c.id)).not.toContain(provider.providerId);
      const ids = (await listAll({ categoryId, districtId: m.seyhan })).map((c) => c.id);
      expect(ids).not.toContain(provider.providerId);
    });
  });

  describe('customer home', () => {
    it('has the documented shape with real sections', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const done = await completedJob(ctx, m, await agreedJob(ctx, m, { customer }));
      const active = await agreedJob(ctx, m, { customer });
      const open = await createRequestV2(ctx, customer, { categoryId: m.elektrikId });
      const quoter = await providerIn(ctx, {
        categoryIds: [m.elektrikId],
        districtIds: [m.seyhan],
      });
      await createQuote(ctx, quoter, open.id, 90000);
      await ctx
        .http()
        .put(`/api/v1/me/favorites/${quoter.providerId}`)
        .set('Authorization', bearer(customer))
        .expect(204);

      const res = await ctx
        .http()
        .get('/api/v1/me/home')
        .set('Authorization', bearer(customer))
        .expect(200);
      const home = customerHomeSchema.parse(res.body);
      expect(home.area).toEqual({
        province: { id: m.provinceId, name: 'Adana' },
        district: { id: m.seyhan, name: 'Seyhan' },
      });
      expect(home.launchStatus).toBe('ACTIVE');
      expect(home.activeJobs.map((j) => j.jobId)).toContain(active.jobId);
      expect(home.activeJobs.map((j) => j.jobId)).not.toContain(done.jobId);
      expect(home.activeJobs.find((j) => j.jobId === active.jobId)?.total.amountMinor).toBe(220000);
      expect(home.requestsWithQuotes).toEqual([
        expect.objectContaining({ requestId: open.id, openQuoteCount: 1 }),
      ]);
      expect(home.favorites.map((c) => c.id)).toEqual([quoter.providerId]);
      expect(home.rehire.map((r) => r.jobId)).toEqual([done.jobId]);
      expect(home.rehire[0]?.provider.id).toBe(done.provider.providerId);
      expect(home.recentCategories.map((c) => c.id)).toEqual(
        expect.arrayContaining([m.klimaId, m.elektrikId]),
      );
      expect(home.nearbyProviders.length).toBeGreaterThan(0);
      expect(JSON.stringify(home)).not.toMatch(/\+90|@ustago\.test/);
    });

    it('without an address: no area and no nearby providers', async () => {
      const auth = await phoneLogin(ctx);
      const res = await ctx
        .http()
        .get('/api/v1/me/home')
        .set('Authorization', bearer(auth))
        .expect(200);
      const home = customerHomeSchema.parse(res.body);
      expect(home).toMatchObject({
        area: null,
        launchStatus: null,
        activeJobs: [],
        requestsWithQuotes: [],
        favorites: [],
        rehire: [],
        nearbyProviders: [],
      });
    });

    it('needs sign-in', async () => {
      await ctx.http().get('/api/v1/me/home').expect(401);
    });
  });
});
