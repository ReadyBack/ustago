import { serviceRequestSchema } from '@ustago/validation';

import {
  addTimeOff,
  createRequestV2,
  detailStatus,
  dispatchesOf,
  dispatchNotifications,
  dispatchService,
  districtId,
  getRequest,
  makeWaveDue,
  newCategory,
  patchAvailability,
  runWave,
  setCoverage,
  setRegions,
} from './faz7-helpers.js';
import {
  bearer,
  cleanup,
  createStaffUser,
  createTestApp,
  resetRateLimits,
  type TestContext,
} from './helpers.js';
import {
  adanaMarket,
  createQuote,
  customerIn,
  type Market,
  opportunityIds,
  type ProviderActor,
  providerIn,
} from './marketplace-helpers.js';
import { asActor, type Actor } from './provider-helpers.js';

/**
 * Faz 7 wave dispatch (docs/adr/0028): who is told about a new request,
 * in which wave, how (push / in-app / nothing), and never twice. The
 * background sweep is off in tests, so later waves are driven through
 * DispatchService directly.
 */
describe('Faz 7: dispatch (e2e)', () => {
  let ctx: TestContext;
  let m: Market;
  let admin: Actor;
  let kozan: string;
  let saricam: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetRateLimits(ctx);
    m = await adanaMarket(ctx);
    admin = asActor(await createStaffUser(ctx, ['ADMIN']));
    kozan = await districtId(ctx, m.provinceId, 'kozan');
    saricam = await districtId(ctx, m.provinceId, 'saricam');
  });

  afterAll(async () => {
    await m.restore();
    await cleanup(ctx);
    await ctx.app.close();
  });

  const inSeyhan = (categoryId: string, extra: Partial<Parameters<typeof providerIn>[1]> = {}) =>
    providerIn(ctx, { categoryIds: [categoryId], districtIds: [m.seyhan], ...extra });

  it('publishing dispatches wave 1 with a MATCH_V1 score, breakdown and one push each', async () => {
    const categoryId = await newCategory(ctx);
    const a = await inSeyhan(categoryId);
    const b = await inSeyhan(categoryId);
    const customer = await customerIn(ctx, m.seyhan);
    const request = await createRequestV2(ctx, customer, { categoryId });

    const rows = await dispatchesOf(ctx, request.id);
    expect(rows.map((r) => r.providerId).sort()).toEqual([a.providerId, b.providerId].sort());
    for (const row of rows) {
      expect(row.wave).toBe(1);
      expect(row.algorithmVersion).toBe('MATCH_V1');
      expect(Number(row.matchScore)).toBeGreaterThanOrEqual(0);
      expect(Number(row.matchScore)).toBeLessThanOrEqual(100);
      expect(row.scoreBreakdown).toBeTypeOf('object');
      expect(Object.keys(row.scoreBreakdown as object).length).toBeGreaterThan(0);
      expect(row.notifyMode).toBe('PUSH');
      expect(row.isPreferred).toBe(false);
      expect(row.result).toBe('PENDING');
    }
    const notes = await dispatchNotifications(ctx, request.id);
    expect(notes.map((n) => n.userId).sort()).toEqual([a.userId, b.userId].sort());
    for (const n of notes) {
      expect(n.type).toBe('service_request.new_opportunity');
      expect(n.pushDelivery).not.toBeNull();
      // The notification never carries the customer's address or name.
      expect(`${n.title} ${n.body}`).not.toMatch(/Atatürk|Müşteri|Kapı kodu/);
    }

    // The customer sees the dispatch summary on the request.
    const view = await getRequest(ctx, customer, request.id);
    expect(view.dispatch).toMatchObject({
      wave: 1,
      dispatchedCount: 2,
      viewedCount: 0,
      quoteCount: 0,
      supply: 'OK',
    });

    // Opening the opportunity marks the dispatch as viewed, once.
    const first = await ctx
      .http()
      .get(`/api/v1/providers/me/opportunities/${request.id}`)
      .set('Authorization', bearer(a))
      .expect(200);
    expect(first.body.dispatch.wave).toBe(1);
    const viewedAt = (
      await ctx.prisma.requestDispatch.findFirstOrThrow({
        where: { serviceRequestId: request.id, providerId: a.providerId },
      })
    ).viewedAt;
    expect(viewedAt).not.toBeNull();
    await ctx
      .http()
      .get(`/api/v1/providers/me/opportunities/${request.id}`)
      .set('Authorization', bearer(a))
      .expect(200);
    const again = await ctx.prisma.requestDispatch.findFirstOrThrow({
      where: { serviceRequestId: request.id, providerId: a.providerId },
    });
    expect(again.viewedAt?.getTime()).toBe(viewedAt?.getTime());
    expect((await getRequest(ctx, customer, request.id)).dispatch?.viewedCount).toBe(1);

    // A quote closes the dispatch row.
    await createQuote(ctx, b, request.id, 180000);
    const answered = await ctx.prisma.requestDispatch.findFirstOrThrow({
      where: { serviceRequestId: request.id, providerId: b.providerId },
    });
    expect(answered.result).toBe('QUOTED');
    expect(answered.respondedAt).not.toBeNull();
  });

  describe('never dispatches to', () => {
    it('suspended, job-restricted, blocked, paused, on-leave or too-far providers', async () => {
      const categoryId = await newCategory(ctx);
      const customer = await customerIn(ctx, m.seyhan);
      const ok = await inSeyhan(categoryId);
      const suspended = await inSeyhan(categoryId, { status: 'SUSPENDED' });
      const accountSuspended = await inSeyhan(categoryId);
      await ctx.prisma.providerProfile.update({
        where: { id: accountSuspended.providerId },
        data: { accountStatus: 'SUSPENDED' },
      });
      const banned = await inSeyhan(categoryId);
      await ctx.prisma.providerProfile.update({
        where: { id: banned.providerId },
        data: { accountStatus: 'BANNED' },
      });
      const restricted = await inSeyhan(categoryId);
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
      const blockedByCustomer = await inSeyhan(categoryId);
      const blockedCustomer = await inSeyhan(categoryId);
      await ctx.prisma.userBlock.createMany({
        data: [
          { blockerId: customer.userId, blockedId: blockedByCustomer.userId },
          { blockerId: blockedCustomer.userId, blockedId: customer.userId },
        ],
      });
      const paused = await inSeyhan(categoryId);
      await patchAvailability(ctx, paused, { acceptingNewJobs: false }).expect(200);
      const today = await inSeyhan(categoryId);
      await patchAvailability(ctx, today, { availableToday: false }).expect(200);
      const onLeave = await inSeyhan(categoryId);
      await addTimeOff(
        ctx,
        onLeave,
        new Date(Date.now() - 60_000),
        new Date(Date.now() + 86400_000),
      ).expect(201);
      const tooFar = await providerIn(ctx, {
        categoryIds: [categoryId],
        districtIds: [m.seyhan, kozan],
      });
      await setCoverage(ctx, tooFar, { serviceCenterDistrictId: kozan, maxTravelKm: 20 }).expect(
        200,
      );

      const request = await createRequestV2(ctx, customer, { categoryId });
      const excluded: ProviderActor[] = [
        suspended,
        accountSuspended,
        banned,
        restricted,
        blockedByCustomer,
        blockedCustomer,
        paused,
        today,
        onLeave,
        tooFar,
      ];

      // Later waves (and a manual expansion) never pick them up either.
      await runWave(ctx, request.id);
      await runWave(ctx, request.id);
      await runWave(ctx, request.id);

      const dispatched = (await dispatchesOf(ctx, request.id)).map((d) => d.providerId);
      expect(dispatched).toEqual([ok.providerId]);
      const notified = (await dispatchNotifications(ctx, request.id)).map((n) => n.userId);
      expect(notified).toEqual([ok.userId]);

      for (const p of excluded) {
        expect(await detailStatus(ctx, p, request.id)).not.toBe(200);
      }
      for (const p of [
        restricted,
        blockedByCustomer,
        blockedCustomer,
        paused,
        today,
        onLeave,
        tooFar,
      ]) {
        expect(await opportunityIds(ctx, p)).not.toContain(request.id);
      }
      expect(await opportunityIds(ctx, ok)).toContain(request.id);
    });

    it('LIMITED accounts get no NOW requests (they may still quote, as in Faz 6)', async () => {
      const categoryId = await newCategory(ctx, { supportsNow: true });
      const nowReady = { nowEnabled: true, isAvailableNow: true };
      const active = await inSeyhan(categoryId, nowReady);
      const limited = await inSeyhan(categoryId, nowReady);
      await ctx.prisma.providerProfile.update({
        where: { id: limited.providerId },
        data: { accountStatus: 'LIMITED' },
      });
      const customer = await customerIn(ctx, m.seyhan);
      const now = await createRequestV2(ctx, customer, {
        categoryId,
        type: 'NOW',
        budgetMinor: null,
      });
      expect((await dispatchesOf(ctx, now.id)).map((d) => d.providerId)).toEqual([
        active.providerId,
      ]);
      expect(await detailStatus(ctx, limited, now.id)).toBe(404);

      const quote = await createRequestV2(ctx, customer, { categoryId });
      const rows = await dispatchesOf(ctx, quote.id);
      expect(rows.map((d) => d.providerId).sort()).toEqual(
        [active.providerId, limited.providerId].sort(),
      );
      // The limitation lowers the MATCH_V1 score.
      const score = (id: string) => Number(rows.find((r) => r.providerId === id)?.matchScore);
      expect(score(limited.providerId)).toBeLessThan(score(active.providerId));
    });

    it('anyone for a closed or expired request', async () => {
      const categoryId = await newCategory(ctx);
      const customer = await customerIn(ctx, m.seyhan);
      const request = await createRequestV2(ctx, customer, { categoryId });
      const late = await inSeyhan(categoryId);
      await ctx
        .http()
        .post(`/api/v1/service-requests/${request.id}/cancel`)
        .set('Authorization', bearer(customer))
        .send({})
        .expect(200);
      expect(await runWave(ctx, request.id)).toBe(0);
      expect(await dispatchesOf(ctx, request.id)).toEqual([]);
      const row = await ctx.prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
      expect(row.nextDispatchAt).toBeNull();
      expect(await opportunityIds(ctx, late)).not.toContain(request.id);
    });
  });

  describe('notification modes (newJobAlerts)', () => {
    async function withAlerts(mode: 'ON' | 'SILENT' | 'OFF', categoryId: string, extra = {}) {
      const p = await inSeyhan(categoryId, extra);
      await ctx
        .http()
        .patch('/api/v1/me/notification-preferences')
        .set('Authorization', bearer(p))
        .send({ newJobAlerts: mode })
        .expect(200);
      return p;
    }

    it('ON pushes, SILENT is in-app only, OFF records the dispatch without a notification', async () => {
      const categoryId = await newCategory(ctx);
      const on = await withAlerts('ON', categoryId);
      const silent = await withAlerts('SILENT', categoryId);
      const off = await withAlerts('OFF', categoryId);
      const request = await createRequestV2(ctx, await customerIn(ctx, m.seyhan), { categoryId });

      const rows = await dispatchesOf(ctx, request.id);
      const modeOf = (p: ProviderActor) =>
        rows.find((r) => r.providerId === p.providerId)?.notifyMode;
      expect(modeOf(on)).toBe('PUSH');
      expect(modeOf(silent)).toBe('IN_APP');
      expect(modeOf(off)).toBe('NONE');

      const notes = await dispatchNotifications(ctx, request.id);
      const noteOf = (p: ProviderActor) => notes.filter((n) => n.userId === p.userId);
      expect(noteOf(on)).toHaveLength(1);
      expect(noteOf(on)[0]?.pushDelivery).not.toBeNull();
      expect(noteOf(silent)).toHaveLength(1);
      expect(noteOf(silent)[0]?.pushDelivery).toBeNull();
      expect(noteOf(off)).toHaveLength(0);
      // OFF only silences alerts: the job is still in the feed.
      expect(await opportunityIds(ctx, off)).toContain(request.id);
    });

    it('NOW always alerts, whatever the preference', async () => {
      const categoryId = await newCategory(ctx, { supportsNow: true });
      const nowReady = { nowEnabled: true, isAvailableNow: true };
      const silent = await withAlerts('SILENT', categoryId, nowReady);
      const off = await withAlerts('OFF', categoryId, nowReady);
      const request = await createRequestV2(ctx, await customerIn(ctx, m.seyhan), {
        categoryId,
        type: 'NOW',
        budgetMinor: null,
      });
      const rows = await dispatchesOf(ctx, request.id);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.notifyMode === 'PUSH')).toBe(true);
      const notes = await dispatchNotifications(ctx, request.id);
      expect(notes.map((n) => n.userId).sort()).toEqual([silent.userId, off.userId].sort());
      expect(notes.every((n) => n.type === 'now.new_request' && n.pushDelivery !== null)).toBe(
        true,
      );
      const offers = await ctx.prisma.emergencyDispatchOffer.count({
        where: { serviceRequestId: request.id },
      });
      expect(offers).toBe(2);
    });
  });

  describe('waves', () => {
    it('sends 10 in wave 1 and the rest in wave 2, each provider exactly once', async () => {
      const categoryId = await newCategory(ctx);
      const providers: ProviderActor[] = [];
      for (let i = 0; i < 12; i += 1) providers.push(await inSeyhan(categoryId));
      const customer = await customerIn(ctx, m.seyhan);
      const request = await createRequestV2(ctx, customer, { categoryId });

      const wave1 = await dispatchesOf(ctx, request.id);
      expect(wave1).toHaveLength(10);
      expect(wave1.every((r) => r.wave === 1)).toBe(true);
      const after1 = await ctx.prisma.serviceRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      expect(after1.dispatchWave).toBe(1);
      expect(after1.nextDispatchAt).not.toBeNull();
      expect(after1.nextDispatchAt?.getTime()).toBeGreaterThan(Date.now());

      // Nothing is due yet: the sweep leaves it alone.
      expect(await dispatchService(ctx).sweep()).toBe(0);
      expect(await dispatchesOf(ctx, request.id)).toHaveLength(10);

      await makeWaveDue(ctx, request.id);
      expect(await dispatchService(ctx).sweep()).toBeGreaterThanOrEqual(1);
      const all = await dispatchesOf(ctx, request.id);
      expect(all).toHaveLength(12);
      expect(all.filter((r) => r.wave === 2)).toHaveLength(2);
      expect(new Set(all.map((r) => r.providerId)).size).toBe(12);
      const after2 = await ctx.prisma.serviceRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      expect(after2.dispatchWave).toBe(2);
      // Nobody left: no further wave is scheduled.
      expect(after2.nextDispatchAt).toBeNull();

      // Running it again reaches nobody and notifies nobody twice.
      expect(await runWave(ctx, request.id)).toBe(0);
      const notes = await dispatchNotifications(ctx, request.id);
      expect(notes).toHaveLength(12);
      expect(new Set(notes.map((n) => n.userId)).size).toBe(12);
      expect((await getRequest(ctx, customer, request.id)).dispatch).toMatchObject({
        wave: 2,
        dispatchedCount: 12,
      });
    });

    it('widens the radius wave by wave: 15 km, 40 km, then unbounded', async () => {
      const categoryId = await newCategory(ctx);
      // All cover the whole province; only the service centre differs.
      async function regional(centre: string | null) {
        const p = await providerIn(ctx, { categoryIds: [categoryId], districtIds: [] });
        await setRegions(ctx, p, [{ kind: 'PROVINCE', provinceId: m.provinceId }]).expect(200);
        if (centre) await setCoverage(ctx, p, { serviceCenterDistrictId: centre }).expect(200);
        return p;
      }
      const near = await regional(m.cukurova); // ~10 km
      const mid = await regional(saricam); // ~25 km
      const far = await regional(kozan); // ~69 km
      const unknown = await regional(null);
      const customer = await customerIn(ctx, m.seyhan);
      const request = await createRequestV2(ctx, customer, { categoryId });

      const waveOf = async () =>
        new Map((await dispatchesOf(ctx, request.id)).map((d) => [d.providerId, d.wave]));
      expect([...(await waveOf()).entries()]).toEqual([[near.providerId, 1]]);

      await makeWaveDue(ctx, request.id);
      await dispatchService(ctx).sweep();
      let waves = await waveOf();
      expect(waves.get(mid.providerId)).toBe(2);
      expect(waves.has(far.providerId)).toBe(false);
      expect(waves.has(unknown.providerId)).toBe(false);

      await makeWaveDue(ctx, request.id);
      await dispatchService(ctx).sweep();
      waves = await waveOf();
      expect(waves.get(far.providerId)).toBe(3);
      expect(waves.get(unknown.providerId)).toBe(3);
      expect(waves.get(near.providerId)).toBe(1);
      expect(waves.size).toBe(4);

      // The stored distance is the approximate km from the service centre.
      const rows = await dispatchesOf(ctx, request.id);
      const farRow = rows.find((r) => r.providerId === far.providerId);
      expect(Number(farRow?.distanceKm)).toBeGreaterThan(40);
      expect(rows.find((r) => r.providerId === unknown.providerId)?.distanceKm).toBeNull();
    });

    it('stops scheduled waves once enough quotes arrived', async () => {
      const categoryId = await newCategory(ctx);
      const quoting: ProviderActor[] = [];
      for (let i = 0; i < 3; i += 1) quoting.push(await inSeyhan(categoryId));
      const request = await createRequestV2(ctx, await customerIn(ctx, m.seyhan), { categoryId });
      for (const p of quoting) await createQuote(ctx, p, request.id, 150000);
      const latecomer = await inSeyhan(categoryId);
      await makeWaveDue(ctx, request.id);
      await dispatchService(ctx).sweep();
      const ids = (await dispatchesOf(ctx, request.id)).map((d) => d.providerId);
      expect(ids).not.toContain(latecomer.providerId);
      const row = await ctx.prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
      expect(row.nextDispatchAt).toBeNull();
    });

    it('two concurrent dispatch runs never dispatch or notify a provider twice', async () => {
      const categoryId = await newCategory(ctx);
      for (let i = 0; i < 12; i += 1) await inSeyhan(categoryId);
      const request = await createRequestV2(ctx, await customerIn(ctx, m.seyhan), { categoryId });
      expect(await dispatchesOf(ctx, request.id)).toHaveLength(10);

      const sent = await Promise.all([runWave(ctx, request.id), runWave(ctx, request.id)]);
      expect(sent.sort()).toEqual([0, 2]);

      const rows = await dispatchesOf(ctx, request.id);
      expect(rows).toHaveLength(12);
      expect(new Set(rows.map((r) => r.providerId)).size).toBe(12);
      const notes = await dispatchNotifications(ctx, request.id);
      expect(notes).toHaveLength(12);
      expect(new Set(notes.map((n) => n.userId)).size).toBe(12);
      const row = await ctx.prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
      expect(row.dispatchWave).toBe(2);
    });

    it('concurrent sweeps take each due request once', async () => {
      const categoryId = await newCategory(ctx);
      for (let i = 0; i < 11; i += 1) await inSeyhan(categoryId);
      const request = await createRequestV2(ctx, await customerIn(ctx, m.seyhan), { categoryId });
      await makeWaveDue(ctx, request.id);
      await Promise.all([
        dispatchService(ctx).sweep(),
        dispatchService(ctx).sweep(),
        dispatchService(ctx).sweep(),
      ]);
      const rows = await dispatchesOf(ctx, request.id);
      expect(rows).toHaveLength(11);
      expect(rows.filter((r) => r.wave === 2)).toHaveLength(1);
      expect(await dispatchNotifications(ctx, request.id)).toHaveLength(11);
    });
  });

  describe('"Arama alanını genişlet"', () => {
    it('sends the next wave now, then refuses again during the cooldown', async () => {
      const categoryId = await newCategory(ctx);
      await regionalAt(categoryId, m.cukurova);
      const mid = await regionalAt(categoryId, saricam);
      const customer = await customerIn(ctx, m.seyhan);
      const request = await createRequestV2(ctx, customer, { categoryId });
      expect(request.dispatch?.wave).toBe(1);

      // Right after publishing: too soon.
      const soon = await ctx
        .http()
        .post(`/api/v1/service-requests/${request.id}/expand-search`)
        .set('Authorization', bearer(customer))
        .send({});
      expect(soon.status).toBe(409);
      expect(soon.body.code).toBe('SEARCH_RECENTLY_EXPANDED');

      await ctx.prisma.serviceRequest.update({
        where: { id: request.id },
        data: { lastDispatchedAt: new Date(Date.now() - 5 * 60_000) },
      });
      const before = await getRequest(ctx, customer, request.id);
      expect(before.dispatch?.canExpand).toBe(true);

      const res = await ctx
        .http()
        .post(`/api/v1/service-requests/${request.id}/expand-search`)
        .set('Authorization', bearer(customer))
        .send({})
        .expect(200);
      const expanded = serviceRequestSchema.parse(res.body);
      expect(expanded.dispatch?.wave).toBe(2);
      expect(expanded.dispatch?.dispatchedCount).toBe(2);
      expect(expanded.dispatch?.canExpand).toBe(false);
      expect((await dispatchesOf(ctx, request.id)).map((d) => d.providerId)).toContain(
        mid.providerId,
      );
      const events = await ctx.prisma.marketplaceEvent.count({
        where: { serviceRequestId: request.id, type: 'request_search_expanded' },
      });
      expect(events).toBe(1);

      const again = await ctx
        .http()
        .post(`/api/v1/service-requests/${request.id}/expand-search`)
        .set('Authorization', bearer(customer))
        .send({});
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('SEARCH_RECENTLY_EXPANDED');
    });

    it('is owner-only and only for open requests', async () => {
      const categoryId = await newCategory(ctx);
      const customer = await customerIn(ctx, m.seyhan);
      const request = await createRequestV2(ctx, customer, { categoryId });
      const stranger = await customerIn(ctx, m.seyhan);
      const res = await ctx
        .http()
        .post(`/api/v1/service-requests/${request.id}/expand-search`)
        .set('Authorization', bearer(stranger))
        .send({});
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('SERVICE_REQUEST_NOT_FOUND');

      await ctx
        .http()
        .post(`/api/v1/service-requests/${request.id}/cancel`)
        .set('Authorization', bearer(customer))
        .send({})
        .expect(200);
      const closed = await ctx
        .http()
        .post(`/api/v1/service-requests/${request.id}/expand-search`)
        .set('Authorization', bearer(customer))
        .send({});
      expect(closed.status).toBe(409);
      expect(closed.body.code).toBe('INVALID_REQUEST_STATE');
    });
  });

  describe('"Henüz teklif gelmedi" alert', () => {
    it('is sent once per request, even when two sweeps race', async () => {
      const categoryId = await newCategory(ctx);
      const customer = await customerIn(ctx, m.seyhan);
      const request = await createRequestV2(ctx, customer, { categoryId });
      const quoted = await createRequestV2(ctx, customer, { categoryId });
      const provider = await inSeyhan(categoryId);
      await createQuote(ctx, provider, quoted.id, 100000);
      const old = new Date(Date.now() - 7 * 24 * 3600_000);
      await ctx.prisma.serviceRequest.updateMany({
        where: { id: { in: [request.id, quoted.id] } },
        data: { publishedAt: old },
      });
      expect((await getRequest(ctx, customer, request.id)).dispatch?.noOfferPrompt).toBe(true);
      expect((await getRequest(ctx, customer, quoted.id)).dispatch?.noOfferPrompt).toBe(false);

      await Promise.all([dispatchService(ctx).alertNoOffer(), dispatchService(ctx).alertNoOffer()]);
      await dispatchService(ctx).alertNoOffer();

      const alerts = await ctx.prisma.notification.findMany({
        where: { userId: customer.userId, type: 'service_request.no_offer' },
      });
      expect(alerts).toHaveLength(1);
      expect(alerts[0]?.data).toMatchObject({ serviceRequestId: request.id });
      const row = await ctx.prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
      expect(row.noOfferAlertedAt).not.toBeNull();
    });
  });

  describe('waitlist provinces', () => {
    it('accept quote requests but dispatch nobody until the province opens', async () => {
      const MERSIN = 33;
      const before = await ctx.prisma.province.findUniqueOrThrow({ where: { id: MERSIN } });
      await ctx.prisma.province.update({
        where: { id: MERSIN },
        data: { isActive: false, waitlistOpen: true },
      });
      try {
        const akdeniz = await districtId(ctx, MERSIN, 'akdeniz');
        const categoryId = await newCategory(ctx, { supportsNow: true });
        const provider = await providerIn(ctx, {
          categoryIds: [categoryId],
          districtIds: [akdeniz],
          nowEnabled: true,
          isAvailableNow: true,
        });
        const customer = await customerIn(ctx, akdeniz, MERSIN);

        const now = await ctx
          .http()
          .post('/api/v1/service-requests')
          .set('Authorization', bearer(customer))
          .send({
            type: 'NOW',
            categoryId,
            addressId: customer.addressId,
            title: 'Acil elektrik',
            description: 'Evde elektrik tamamen gitti, acil bakılması gerekiyor lütfen.',
            budgetMinor: null,
          });
        expect(now.status).toBe(422);

        const request = await createRequestV2(ctx, customer, { categoryId });
        expect(request.status).toBe('PUBLISHED');
        expect(request.dispatch).toMatchObject({ supply: 'WAITLIST', dispatchedCount: 0 });
        expect(await dispatchesOf(ctx, request.id)).toEqual([]);
        expect(await opportunityIds(ctx, provider)).not.toContain(request.id);
        // A retry is scheduled, but a due wave still reaches nobody.
        const row = await ctx.prisma.serviceRequest.findUniqueOrThrow({
          where: { id: request.id },
        });
        expect(row.nextDispatchAt).not.toBeNull();
        await makeWaveDue(ctx, request.id);
        await dispatchService(ctx).sweep();
        expect(await dispatchesOf(ctx, request.id)).toEqual([]);
        expect(await dispatchNotifications(ctx, request.id)).toEqual([]);

        // Opened: the next due wave reaches the provider.
        await ctx.prisma.province.update({ where: { id: MERSIN }, data: { isActive: true } });
        await makeWaveDue(ctx, request.id);
        await dispatchService(ctx).sweep();
        expect((await dispatchesOf(ctx, request.id)).map((d) => d.providerId)).toEqual([
          provider.providerId,
        ]);
        expect(await dispatchNotifications(ctx, request.id)).toHaveLength(1);
        expect((await getRequest(ctx, customer, request.id)).dispatch?.supply).toBe('OK');
      } finally {
        await ctx.prisma.province.update({
          where: { id: MERSIN },
          data: { isActive: before.isActive, waitlistOpen: before.waitlistOpen },
        });
      }
    });
  });

  // -------------------------------------------------------------------------

  async function regionalAt(categoryId: string, centre: string) {
    const p = await providerIn(ctx, { categoryIds: [categoryId], districtIds: [] });
    await setRegions(ctx, p, [{ kind: 'PROVINCE', provinceId: m.provinceId }]).expect(200);
    await setCoverage(ctx, p, { serviceCenterDistrictId: centre }).expect(200);
    return p;
  }
});
