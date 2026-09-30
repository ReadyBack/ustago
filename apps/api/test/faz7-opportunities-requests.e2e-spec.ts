import type { Opportunity, Quote } from '@ustago/types';
import {
  opportunitySchema,
  paginatedSchema,
  quoteSchema,
  rehireDraftSchema,
  requestFormSchema,
} from '@ustago/validation';

import {
  createRequestV2,
  detailStatus,
  dispatchesOf,
  dispatchNotifications,
  districtId,
  getRequest,
  newCategory,
  postRequestV2,
  privateCustomer,
  setCoverage,
} from './faz7-helpers.js';
import { bearer, cleanup, createTestApp, resetRateLimits, type TestContext } from './helpers.js';
import { agreedJob, completedJob, postReview } from './job-helpers.js';
import {
  adanaMarket,
  createQuote,
  customerIn,
  type Market,
  opportunityIds,
  postQuote,
  type ProviderActor,
  providerIn,
} from './marketplace-helpers.js';
import type { Actor } from './provider-helpers.js';

const opportunityPage = paginatedSchema(opportunitySchema);

/** Every key anywhere in a JSON value. */
function allKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
}

/**
 * Faz 7 "Sana Uygun İşler" (filters, sorting, cursor paging, privacy),
 * request V2 (budget range, schedule, category answers, preferred provider,
 * rehire) and the quote V2 comparison.
 */
describe('Faz 7: opportunities, requests V2 and quote comparison (e2e)', () => {
  let ctx: TestContext;
  let m: Market;
  let kozan: string;
  let saricam: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetRateLimits(ctx);
    m = await adanaMarket(ctx);
    kozan = await districtId(ctx, m.provinceId, 'kozan');
    saricam = await districtId(ctx, m.provinceId, 'saricam');
  });

  afterAll(async () => {
    await m.restore();
    await cleanup(ctx);
    await ctx.app.close();
  });

  async function feedPage(provider: Actor, query: string) {
    const res = await ctx
      .http()
      .get(`/api/v1/providers/me/opportunities${query}`)
      .set('Authorization', bearer(provider))
      .expect(200);
    return opportunityPage.parse(res.body);
  }

  async function allPages(provider: Actor, query: string, limit: number) {
    const items: Opportunity[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i += 1) {
      const sep = query ? '&' : '?';
      const page = await feedPage(
        provider,
        `${query}${sep}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      expect(page.items.length).toBeLessThanOrEqual(limit);
      items.push(...(page.items as Opportunity[]));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(cursor).toBeNull();
    return items;
  }

  describe('the opportunity feed', () => {
    let provider: ProviderActor;
    let latecomer: ProviderActor;
    let catX: string;
    let catY: string;
    const ids: Record<string, string> = {};

    beforeAll(async () => {
      catX = await newCategory(ctx);
      catY = await newCategory(ctx);
      provider = await providerIn(ctx, {
        categoryIds: [catX, catY],
        districtIds: [m.seyhan, m.cukurova, saricam, kozan],
      });
      await setCoverage(ctx, provider, { serviceCenterDistrictId: m.seyhan }).expect(200);
      const seyhanCustomer = await customerIn(ctx, m.seyhan);
      const cukurovaCustomer = await customerIn(ctx, m.cukurova);
      const saricamCustomer = await customerIn(ctx, saricam);
      const kozanCustomer = await customerIn(ctx, kozan);
      const make = async (key: string, c: typeof seyhanCustomer, input: object) => {
        ids[key] = (await createRequestV2(ctx, c, { categoryId: catX, ...input })).id;
      };
      await make('seyhanLow', seyhanCustomer, { budgetMinor: 100000 });
      await make('seyhanRange', seyhanCustomer, { budgetMinor: 300000, budgetMaxMinor: 400000 });
      await make('cukurova', cukurovaCustomer, { budgetMinor: 200000 });
      await make('cukurovaNoBudget', cukurovaCustomer, { budgetMinor: null });
      await make('saricam', saricamCustomer, { budgetMinor: 150000 });
      await make('kozan', kozanCustomer, { budgetMinor: 500000 });
      await make('seyhanY', seyhanCustomer, { categoryId: catY, budgetMinor: 200000 });
      latecomer = await providerIn(ctx, { categoryIds: [catX, catY], districtIds: [m.seyhan] });
    });

    it('NEW: newest first, paged by cursor without duplicates or gaps', async () => {
      const items = await allPages(provider, '?sort=NEW', 2);
      const seen = items.map((o) => o.id);
      expect(new Set(seen).size).toBe(seen.length);
      expect([...seen].sort()).toEqual(Object.values(ids).sort());
      expect(seen).toEqual([...seen].sort().reverse());
    });

    it('NEAREST: by approximate distance, ties broken stably across pages', async () => {
      for (const limit of [1, 2, 3]) {
        const items = await allPages(provider, '?sort=NEAREST', limit);
        const seen = items.map((o) => o.id);
        expect(new Set(seen).size).toBe(seen.length);
        expect([...seen].sort()).toEqual(Object.values(ids).sort());
        const km = items.map((o) => o.distance?.km ?? Number.POSITIVE_INFINITY);
        expect(km).toEqual([...km].sort((a, b) => a - b));
      }
      const first = (await feedPage(provider, '?sort=NEAREST&limit=3')).items;
      expect(first.every((o) => o.location.district.id === m.seyhan)).toBe(true);
      const last = (await allPages(provider, '?sort=NEAREST', 3)).at(-1);
      expect(last?.id).toBe(ids['kozan']);
    });

    it('BUDGET: highest budget (upper end of a range) first, no-budget last', async () => {
      const items = await allPages(provider, '?sort=BUDGET', 2);
      const seen = items.map((o) => o.id);
      expect(new Set(seen).size).toBe(seen.length);
      expect([...seen].sort()).toEqual(Object.values(ids).sort());
      expect(seen[0]).toBe(ids['kozan']);
      expect(seen[1]).toBe(ids['seyhanRange']);
      expect(seen.at(-1)).toBe(ids['cukurovaNoBudget']);
      const key = (o: Opportunity) => o.budgetMax?.amountMinor ?? o.budget?.amountMinor ?? -1;
      expect(items.map(key)).toEqual(items.map(key).sort((a, b) => b - a));
      const range = items.find((o) => o.id === ids['seyhanRange']);
      expect(range?.budget?.amountMinor).toBe(300000);
      expect(range?.budgetMax?.amountMinor).toBe(400000);
    });

    it('filters by distance, category and "dispatched to me"', async () => {
      const near = (await allPages(provider, '?maxDistanceKm=15', 10)).map((o) => o.id).sort();
      expect(near).toEqual(
        [
          ids['seyhanLow'],
          ids['seyhanRange'],
          ids['cukurova'],
          ids['cukurovaNoBudget'],
          ids['seyhanY'],
        ]
          .map(String)
          .sort(),
      );
      const onlyY = (await allPages(provider, `?categoryId=${catY}`, 10)).map((o) => o.id);
      expect(onlyY).toEqual([ids['seyhanY']]);

      // The provider serves every district: all were dispatched to them in wave 1.
      const mine = (await allPages(provider, '?dispatchedOnly=true', 10)).map((o) => o.id);
      expect([...mine].sort()).toEqual(Object.values(ids).sort());
      const withDispatch = await allPages(provider, '', 10);
      expect(withDispatch.every((o) => o.dispatch?.wave === 1)).toBe(true);

      // A provider who joined later sees the Seyhan requests, none dispatched to them.
      const lateFeed = await allPages(latecomer, '', 10);
      expect(lateFeed.map((o) => o.id)).toEqual(
        expect.arrayContaining([ids['seyhanLow'], ids['seyhanY']]),
      );
      expect(lateFeed.every((o) => o.dispatch === null)).toBe(true);
      expect(await allPages(latecomer, '?dispatchedOnly=true', 10)).toEqual([]);
      // No service centre: no distance, so a distance filter excludes everything.
      expect(await allPages(latecomer, '?maxDistanceKm=500', 10)).toEqual([]);
    });

    it('rejects malformed filters and non-providers', async () => {
      for (const q of ['?sort=CHEAPEST', '?maxDistanceKm=0', '?limit=51', '?cursor=a%2Bb']) {
        await ctx
          .http()
          .get(`/api/v1/providers/me/opportunities${q}`)
          .set('Authorization', bearer(provider))
          .expect(400);
      }
      const customer = await customerIn(ctx, m.seyhan);
      await ctx
        .http()
        .get('/api/v1/providers/me/opportunities')
        .set('Authorization', bearer(customer))
        .expect(403);
    });
  });

  describe('privacy before agreement', () => {
    it('no name, phone, e-mail, street, building, apartment, postal code or coordinates', async () => {
      const categoryId = await newCategory(ctx);
      const provider = await providerIn(ctx, {
        categoryIds: [categoryId],
        districtIds: [m.seyhan],
      });
      await setCoverage(ctx, provider, { serviceCenterDistrictId: m.cukurova }).expect(200);
      const customer = await privateCustomer(ctx, m.provinceId, m.seyhan, {
        latitude: 36.991234,
        longitude: 35.318765,
      });
      const request = await createRequestV2(ctx, customer, {
        categoryId,
        budgetMinor: 120000,
        budgetMaxMinor: 180000,
        scheduleOption: 'TOMORROW',
      });
      // The customer sees their own full address.
      expect(request.address.addressLine).toContain('Gizlisokak');
      expect(request.scheduleOption).toBe('TOMORROW');
      expect(request.budgetMax?.amountMinor).toBe(180000);

      const list = await feedPage(provider, '');
      const item = list.items.find((o) => o.id === request.id);
      expect(item).toBeDefined();
      const detailRes = await ctx
        .http()
        .get(`/api/v1/providers/me/opportunities/${request.id}`)
        .set('Authorization', bearer(provider))
        .expect(200);
      const detail = opportunitySchema.strict().parse(detailRes.body);
      expect(detail.scheduleOption).toBe('TOMORROW');
      expect(detail.budgetMax?.amountMinor).toBe(180000);
      expect(detail.location).toEqual({
        province: { id: m.provinceId, name: 'Adana' },
        district: { id: m.seyhan, name: 'Seyhan' },
      });
      expect(detail.distance?.approximate).toBe(true);

      const forbiddenKeys = [
        'address',
        'addressLine',
        'addressId',
        'neighborhood',
        'buildingNo',
        'apartmentNo',
        'postalCode',
        'instructions',
        'latitude',
        'longitude',
        'lat',
        'lng',
        'approxLatitude',
        'approxLongitude',
        'customer',
        'customerId',
        'phone',
        'email',
        'firstName',
        'lastName',
      ];
      const digits = customer.phone.replace('+90', '');
      const secrets = [
        'Gizlisokak',
        '47B',
        'Daire 19',
        '01170',
        '8642',
        'Reşatbey',
        'Zeynep',
        'Gizlisoyad',
        digits,
        '36.99',
        '35.31',
        '35.32',
        customer.userId,
      ];
      for (const body of [item, detailRes.body]) {
        const keys = allKeys(body);
        for (const k of forbiddenKeys) expect(keys.has(k), k).toBe(false);
        const text = JSON.stringify(body);
        for (const s of secrets) expect(text, s).not.toContain(s);
      }
      // Nor in the new-job notification.
      const notes = await dispatchNotifications(ctx, request.id);
      expect(notes).toHaveLength(1);
      const noteText = JSON.stringify(notes.map((n) => [n.title, n.body, n.data]));
      for (const s of secrets) expect(noteText).not.toContain(s);
    });
  });

  describe('request V2', () => {
    it('validates the budget range', async () => {
      const categoryId = await newCategory(ctx);
      const customer = await customerIn(ctx, m.seyhan);
      const inverted = await postRequestV2(ctx, customer, {
        categoryId,
        budgetMinor: 200000,
        budgetMaxMinor: 100000,
      });
      expect(inverted.status).toBe(400);
      const noLower = await postRequestV2(ctx, customer, {
        categoryId,
        budgetMinor: null,
        budgetMaxMinor: 100000,
      });
      expect(noLower.status).toBe(400);
      const bad = await postRequestV2(ctx, customer, {
        categoryId,
        scheduleOption: 'YESTERDAY' as never,
      });
      expect(bad.status).toBe(400);
    });

    describe('category answers', () => {
      let categoryId: string;
      let customer: Awaited<ReturnType<typeof customerIn>>;

      beforeAll(async () => {
        categoryId = await newCategory(ctx);
        const q = (data: object) =>
          ctx.prisma.categoryQuestion.create({ data: { categoryId, ...data } as never });
        await q({
          key: 'problem',
          label: 'Sorun ne?',
          type: 'SINGLE_SELECT',
          required: true,
          sortOrder: 1,
          options: [
            { value: 'power_out', label: 'Tamamen elektrik yok' },
            { value: 'other', label: 'Diğer' },
          ],
        });
        await q({
          key: 'count',
          label: 'Kaç priz?',
          type: 'NUMBER',
          minValue: 1,
          maxValue: 10,
          sortOrder: 2,
        });
        await q({
          key: 'rooms',
          label: 'Hangi odalar?',
          type: 'MULTI_SELECT',
          sortOrder: 3,
          options: [
            { value: 'salon', label: 'Salon' },
            { value: 'mutfak', label: 'Mutfak' },
            { value: 'banyo', label: 'Banyo' },
          ],
        });
        await q({ key: 'urgent', label: 'Acil mi?', type: 'BOOLEAN', sortOrder: 4 });
        await q({ key: 'note', label: 'Ek not', type: 'SHORT_TEXT', sortOrder: 5 });
        await q({
          key: 'retired',
          label: 'Eski soru',
          type: 'BOOLEAN',
          isActive: false,
          sortOrder: 6,
        });
        customer = await customerIn(ctx, m.seyhan);
      });

      it('the request form lists the active questions only', async () => {
        const res = await ctx
          .http()
          .get(`/api/v1/categories/${categoryId}/request-form`)
          .expect(200);
        const form = requestFormSchema.parse(res.body);
        expect(form.questions.map((q) => q.key)).toEqual([
          'problem',
          'count',
          'rooms',
          'urgent',
          'note',
        ]);
      });

      it.each([
        ['a missing required answer', { count: 2 }, 'problem', 'REQUIRED'],
        ['an unknown option', { problem: 'flood' }, 'problem', 'INVALID_OPTION'],
        ['a number out of range', { problem: 'other', count: 50 }, 'count', 'OUT_OF_RANGE'],
        ['an unknown question', { problem: 'other', ghost: true }, 'ghost', 'UNKNOWN_QUESTION'],
        [
          'an inactive question',
          { problem: 'other', retired: true },
          'retired',
          'UNKNOWN_QUESTION',
        ],
        ['a wrong type', { problem: 'other', urgent: 'evet' }, 'urgent', 'INVALID_TYPE'],
        [
          'an unknown multi option',
          { problem: 'other', rooms: ['salon', 'garaj'] },
          'rooms',
          'INVALID_OPTION',
        ],
        ['markup in text', { problem: 'other', note: '<b>acil</b>' }, 'note', 'INVALID_TEXT'],
      ])('refuses %s with 422 INVALID_CATEGORY_ANSWERS', async (_label, answers, key, code) => {
        const before = await ctx.prisma.serviceRequest.count({
          where: { customer: { userId: customer.userId } },
        });
        const res = await postRequestV2(ctx, customer, { categoryId, answers });
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('INVALID_CATEGORY_ANSWERS');
        expect(res.body.details.errors).toEqual(
          expect.arrayContaining([expect.objectContaining({ key, code })]),
        );
        const after = await ctx.prisma.serviceRequest.count({
          where: { customer: { userId: customer.userId } },
        });
        expect(after).toBe(before);
      });

      it('refuses malformed answer keys before validation (400)', async () => {
        const res = await postRequestV2(ctx, customer, {
          categoryId,
          answers: { 'Bad-Key': 'x' },
        });
        expect(res.status).toBe(400);
      });

      it('stores a snapshot with labels, shown to providers', async () => {
        const provider = await providerIn(ctx, {
          categoryIds: [categoryId],
          districtIds: [m.seyhan],
        });
        const request = await createRequestV2(ctx, customer, {
          categoryId,
          answers: {
            note: 'Salon duvarı',
            urgent: true,
            rooms: ['banyo', 'salon'],
            count: 3,
            problem: 'power_out',
          },
        });
        expect(request.answers.map((a) => a.key)).toEqual([
          'problem',
          'count',
          'rooms',
          'urgent',
          'note',
        ]);
        const problem = request.answers.find((a) => a.key === 'problem');
        expect(problem).toMatchObject({
          label: 'Sorun ne?',
          type: 'SINGLE_SELECT',
          value: 'power_out',
          displayValue: 'Tamamen elektrik yok',
        });
        expect(request.answers.find((a) => a.key === 'count')?.value).toBe(3);
        expect(request.answers.find((a) => a.key === 'rooms')?.value).toEqual(
          expect.arrayContaining(['banyo', 'salon']),
        );

        // Editing the question later never changes the published snapshot.
        await ctx.prisma.categoryQuestion.updateMany({
          where: { categoryId, key: 'problem' },
          data: { label: 'Arıza türü' },
        });
        const opp = await ctx
          .http()
          .get(`/api/v1/providers/me/opportunities/${request.id}`)
          .set('Authorization', bearer(provider))
          .expect(200);
        const parsed = opportunitySchema.parse(opp.body);
        expect(parsed.answers).toEqual(request.answers);
        expect(parsed.answers[0]?.label).toBe('Sorun ne?');
        await ctx.prisma.categoryQuestion.updateMany({
          where: { categoryId, key: 'problem' },
          data: { label: 'Sorun ne?' },
        });
      });
    });

    describe('preferred provider', () => {
      it('"Bu ustadan teklif iste": the preferred provider is dispatched first and told so', async () => {
        const categoryId = await newCategory(ctx);
        const preferred = await providerIn(ctx, {
          categoryIds: [categoryId],
          districtIds: [m.seyhan],
        });
        const other = await providerIn(ctx, { categoryIds: [categoryId], districtIds: [m.seyhan] });
        const customer = await customerIn(ctx, m.seyhan);
        const request = await createRequestV2(ctx, customer, {
          categoryId,
          preferredProviderId: preferred.providerId,
        });
        expect(request.dispatch?.preferredProvider).toMatchObject({
          id: preferred.providerId,
          status: 'WAITING',
          only: false,
        });
        const rows = await dispatchesOf(ctx, request.id);
        expect(rows.find((r) => r.providerId === preferred.providerId)?.isPreferred).toBe(true);
        expect(rows.find((r) => r.providerId === other.providerId)?.isPreferred).toBe(false);
        const notes = await dispatchNotifications(ctx, request.id);
        expect(notes.find((n) => n.userId === preferred.userId)?.type).toBe(
          'service_request.preferred',
        );
        expect(notes.find((n) => n.userId === other.userId)?.type).toBe(
          'service_request.new_opportunity',
        );

        const mine = await ctx
          .http()
          .get(`/api/v1/providers/me/opportunities/${request.id}`)
          .set('Authorization', bearer(preferred))
          .expect(200);
        expect(mine.body.isPreferredForMe).toBe(true);
        const theirs = await ctx
          .http()
          .get(`/api/v1/providers/me/opportunities/${request.id}`)
          .set('Authorization', bearer(other))
          .expect(200);
        expect(theirs.body.isPreferredForMe).toBe(false);
        expect(
          (await getRequest(ctx, customer, request.id)).dispatch?.preferredProvider?.status,
        ).toBe('VIEWED');
        await createQuote(ctx, preferred, request.id, 150000);
        expect(
          (await getRequest(ctx, customer, request.id)).dispatch?.preferredProvider?.status,
        ).toBe('QUOTED');
      });

      it('"Sadece bu usta": nobody else sees it until the customer widens the search', async () => {
        const categoryId = await newCategory(ctx);
        const preferred = await providerIn(ctx, {
          categoryIds: [categoryId],
          districtIds: [m.seyhan],
        });
        const other = await providerIn(ctx, { categoryIds: [categoryId], districtIds: [m.seyhan] });
        const customer = await customerIn(ctx, m.seyhan);
        const request = await createRequestV2(ctx, customer, {
          categoryId,
          preferredProviderId: preferred.providerId,
          preferredOnly: true,
        });
        expect((await dispatchesOf(ctx, request.id)).map((d) => d.providerId)).toEqual([
          preferred.providerId,
        ]);
        expect(await opportunityIds(ctx, other)).not.toContain(request.id);
        expect(await detailStatus(ctx, other, request.id)).toBe(404);
        expect((await postQuote(ctx, other, request.id, { totalMinor: 100000 })).status).toBe(404);
        const row = await ctx.prisma.serviceRequest.findUniqueOrThrow({
          where: { id: request.id },
        });
        expect(row.nextDispatchAt).toBeNull();
        const view = await getRequest(ctx, customer, request.id);
        expect(view.dispatch?.preferredProvider?.only).toBe(true);
        expect(view.dispatch?.canExpand).toBe(true);

        // Widening is allowed straight away (no cooldown for dropping "only").
        const res = await ctx
          .http()
          .post(`/api/v1/service-requests/${request.id}/expand-search`)
          .set('Authorization', bearer(customer))
          .send({ includeOtherProviders: true })
          .expect(200);
        expect(res.body.dispatch.preferredProvider.only).toBe(false);
        expect((await dispatchesOf(ctx, request.id)).map((d) => d.providerId)).toContain(
          other.providerId,
        );
        expect(await opportunityIds(ctx, other)).toContain(request.id);
      });

      it('refuses "only" without a provider and unavailable preferred providers', async () => {
        const categoryId = await newCategory(ctx);
        const otherCategory = await newCategory(ctx);
        const customer = await customerIn(ctx, m.seyhan);
        const onlyWithoutProvider = await postRequestV2(ctx, customer, {
          categoryId,
          preferredOnly: true,
        });
        expect(onlyWithoutProvider.status).toBe(400);

        const wrongCategory = await providerIn(ctx, {
          categoryIds: [otherCategory],
          districtIds: [m.seyhan],
        });
        const suspended = await providerIn(ctx, {
          categoryIds: [categoryId],
          districtIds: [m.seyhan],
          status: 'SUSPENDED',
        });
        for (const p of [wrongCategory, suspended]) {
          const res = await postRequestV2(ctx, customer, {
            categoryId,
            preferredProviderId: p.providerId,
          });
          expect(res.status).toBe(422);
          expect(res.body.code).toBe('PREFERRED_PROVIDER_UNAVAILABLE');
        }
      });
    });

    describe('rehire', () => {
      it('drafts from a completed job and creates a request for the same provider', async () => {
        const job = await completedJob(ctx, m);
        const res = await ctx
          .http()
          .get(`/api/v1/jobs/${job.jobId}/rehire`)
          .set('Authorization', bearer(job.customer))
          .expect(200);
        const draft = rehireDraftSchema.parse(res.body);
        expect(draft).toMatchObject({
          jobId: job.jobId,
          category: { id: m.klimaId },
          provider: { id: job.provider.providerId, available: true },
          addressId: job.customer.addressId,
        });

        const request = await createRequestV2(ctx, job.customer, {
          categoryId: draft.category.id,
          title: draft.title,
          rehireOfJobId: job.jobId,
          preferredOnly: true,
          preferredProviderId: draft.provider.id,
        });
        expect(request.rehireOfJobId).toBe(job.jobId);
        expect(request.dispatch?.preferredProvider).toMatchObject({
          id: job.provider.providerId,
          only: true,
        });
        expect((await dispatchesOf(ctx, request.id)).map((d) => d.providerId)).toEqual([
          job.provider.providerId,
        ]);
        // The old job is untouched.
        const old = await ctx.prisma.job.findUniqueOrThrow({ where: { id: job.jobId } });
        expect(old.status).toBe('COMPLETED');
        expect(
          await ctx.prisma.marketplaceEvent.count({
            where: { serviceRequestId: request.id, type: 'provider_rehired' },
          }),
        ).toBe(1);

        // rehireOfJobId alone implies the job's provider.
        const implied = await createRequestV2(ctx, job.customer, {
          categoryId: m.klimaId,
          rehireOfJobId: job.jobId,
        });
        expect(implied.dispatch?.preferredProvider?.id).toBe(job.provider.providerId);
      });

      it('refuses unfinished, foreign and mismatched jobs', async () => {
        const running = await agreedJob(ctx, m);
        const notDone = await ctx
          .http()
          .get(`/api/v1/jobs/${running.jobId}/rehire`)
          .set('Authorization', bearer(running.customer));
        expect(notDone.status).toBe(422);
        expect(notDone.body.code).toBe('REHIRE_JOB_NOT_COMPLETED');
        const create = await postRequestV2(ctx, running.customer, {
          categoryId: m.klimaId,
          rehireOfJobId: running.jobId,
        });
        expect(create.status).toBe(422);
        expect(create.body.code).toBe('REHIRE_JOB_NOT_FOUND');

        const done = await completedJob(ctx, m);
        const stranger = await customerIn(ctx, m.seyhan);
        const foreign = await ctx
          .http()
          .get(`/api/v1/jobs/${done.jobId}/rehire`)
          .set('Authorization', bearer(stranger));
        expect(foreign.status).toBe(404);
        expect(foreign.body.code).toBe('JOB_NOT_FOUND');
        const foreignCreate = await postRequestV2(ctx, stranger, {
          categoryId: m.klimaId,
          rehireOfJobId: done.jobId,
        });
        expect(foreignCreate.status).toBe(422);
        expect(foreignCreate.body.code).toBe('REHIRE_JOB_NOT_FOUND');

        const mismatch = await postRequestV2(ctx, done.customer, {
          categoryId: m.klimaId,
          rehireOfJobId: done.jobId,
          preferredProviderId: running.provider.providerId,
        });
        expect(mismatch.status).toBe(422);
        expect(mismatch.body.code).toBe('REHIRE_PROVIDER_MISMATCH');

        // A suspended provider can no longer be rehired.
        await ctx.prisma.providerProfile.update({
          where: { id: done.provider.providerId },
          data: { accountStatus: 'SUSPENDED' },
        });
        const draft = await ctx
          .http()
          .get(`/api/v1/jobs/${done.jobId}/rehire`)
          .set('Authorization', bearer(done.customer))
          .expect(200);
        expect(draft.body.provider.available).toBe(false);
        const blocked = await postRequestV2(ctx, done.customer, {
          categoryId: m.klimaId,
          rehireOfJobId: done.jobId,
        });
        expect(blocked.status).toBe(422);
        expect(blocked.body.code).toBe('PREFERRED_PROVIDER_UNAVAILABLE');
      });
    });
  });

  describe('quotes V2', () => {
    async function quotesOf(customer: Actor, requestId: string): Promise<Quote[]> {
      const res = await ctx
        .http()
        .get(`/api/v1/service-requests/${requestId}/quotes`)
        .set('Authorization', bearer(customer))
        .expect(200);
      return (res.body as unknown[]).map((q) => quoteSchema.parse(q));
    }

    it('keeps the breakdown lines and the arrival estimate', async () => {
      const categoryId = await newCategory(ctx);
      const provider = await providerIn(ctx, {
        categoryIds: [categoryId],
        districtIds: [m.seyhan],
      });
      const customer = await customerIn(ctx, m.seyhan);
      const request = await createRequestV2(ctx, customer, { categoryId });
      const mismatch = await postQuote(ctx, provider, request.id, {
        totalMinor: 220000,
        laborMinor: 150000,
        materialMinor: 50000,
        serviceMinor: 15000,
        otherMinor: 1000,
      });
      expect(mismatch.status).toBe(400);
      const customEta = await postQuote(ctx, provider, request.id, {
        totalMinor: 220000,
        arrivalEta: 'CUSTOM',
      });
      expect(customEta.status).toBe(400);

      const quote = await createQuote(ctx, provider, request.id, 220000, {
        laborMinor: 150000,
        materialMinor: 50000,
        serviceMinor: 15000,
        otherMinor: 5000,
        arrivalEta: 'TOMORROW',
      });
      expect(quote.latest).toMatchObject({
        total: { amountMinor: 220000 },
        labor: { amountMinor: 150000 },
        material: { amountMinor: 50000 },
        service: { amountMinor: 15000 },
        other: { amountMinor: 5000 },
        arrivalEta: 'TOMORROW',
      });
      const [listed] = await quotesOf(customer, request.id);
      expect(listed?.latest.service?.amountMinor).toBe(15000);
      // A single offer gets no comparison labels.
      expect(listed?.comparisonLabels).toEqual([]);
    });

    it('labels only unique winners among two or more open offers', async () => {
      const categoryId = await newCategory(ctx);
      const near = await providerIn(ctx, { categoryIds: [categoryId], districtIds: [m.seyhan] });
      const cheap = await providerIn(ctx, { categoryIds: [categoryId], districtIds: [m.seyhan] });
      await setCoverage(ctx, near, { serviceCenterDistrictId: m.seyhan }).expect(200);
      await setCoverage(ctx, cheap, { serviceCenterDistrictId: saricam }).expect(200);
      const customer = await customerIn(ctx, m.seyhan);
      const request = await createRequestV2(ctx, customer, { categoryId });
      const q1 = await createQuote(ctx, near, request.id, 250000);
      const q2 = await createQuote(ctx, cheap, request.id, 200000);

      let quotes = await quotesOf(customer, request.id);
      const byId = new Map(quotes.map((q) => [q.id, q]));
      expect(byId.get(q1.id)?.comparisonLabels).toEqual(['NEAREST']);
      expect(byId.get(q2.id)?.comparisonLabels).toEqual(['LOWEST_PRICE']);
      expect(byId.get(q1.id)?.distance).toEqual({ km: 1, approximate: true });
      expect(byId.get(q2.id)?.distance?.km).toBeGreaterThan(10);
      // No ratings yet: never "en yüksek puan".
      expect(quotes.some((q) => q.comparisonLabels.includes('HIGHEST_RATED'))).toBe(false);

      // A tie on price removes the price label.
      const tie = await providerIn(ctx, { categoryIds: [categoryId], districtIds: [m.seyhan] });
      await createQuote(ctx, tie, request.id, 200000);
      quotes = await quotesOf(customer, request.id);
      expect(quotes.some((q) => q.comparisonLabels.includes('LOWEST_PRICE'))).toBe(false);
      expect(quotes.find((q) => q.id === q1.id)?.comparisonLabels).toEqual(['NEAREST']);

      // Closed offers do not count: one open offer left → no labels at all.
      for (const [p, id] of [
        [cheap, q2.id],
        [tie, quotes.find((q) => q.provider.id === tie.providerId)?.id ?? ''],
      ] as const) {
        await ctx
          .http()
          .post(`/api/v1/quotes/${id}/withdraw`)
          .set('Authorization', bearer(p))
          .send({})
          .expect(200);
      }
      quotes = await quotesOf(customer, request.id);
      expect(quotes.every((q) => q.comparisonLabels.length === 0)).toBe(true);
    });

    it('"En yüksek puan" needs at least three reviews', async () => {
      const rated = await providerIn(ctx, {
        categoryIds: [m.klimaId],
        districtIds: [m.seyhan, m.cukurova],
        displayName: 'Puanlı Usta',
      });
      const fewReviews = await providerIn(ctx, {
        categoryIds: [m.klimaId],
        districtIds: [m.seyhan, m.cukurova],
        displayName: 'Az Yorumlu Usta',
      });
      for (const [provider, count, rating] of [
        [rated, 3, 4],
        [fewReviews, 2, 5],
      ] as const) {
        for (let i = 0; i < count; i += 1) {
          const job = await completedJob(ctx, m, await agreedJob(ctx, m, { provider }));
          await postReview(ctx, job.customer, job.jobId, { rating }).expect(201);
        }
      }
      const customer = await customerIn(ctx, m.seyhan);
      const request = await createRequestV2(ctx, customer, { categoryId: m.klimaId });
      const qRated = await createQuote(ctx, rated, request.id, 300000);
      const qFew = await createQuote(ctx, fewReviews, request.id, 300000);
      const quotes = await quotesOf(customer, request.id);
      const byId = new Map(quotes.map((q) => [q.id, q]));
      expect(byId.get(qFew.id)?.provider.rating).toEqual({ average: 5, count: 2 });
      expect(byId.get(qRated.id)?.provider.rating).toEqual({ average: 4, count: 3 });
      // 5.0 from two reviews does not beat 4.0 from three: only the latter qualifies.
      expect(byId.get(qRated.id)?.comparisonLabels).toEqual(['HIGHEST_RATED']);
      expect(byId.get(qFew.id)?.comparisonLabels).toEqual([]);
    });
  });
});
