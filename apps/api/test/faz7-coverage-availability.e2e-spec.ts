import { randomUUID } from 'node:crypto';

import {
  opportunitySchema,
  providerAvailabilitySchema,
  providerCoverageSchema,
  providerHomeSchema,
} from '@ustago/validation';

import { HaversineDistanceCalculator, roundApproxKm } from '../src/geo/distance.js';
import {
  addTimeOff,
  createRequestV2,
  detailStatus,
  dispatchesOf,
  districtId,
  istanbulWeekday,
  newCategory,
  patchAvailability,
  setCoverage,
  setRegions,
} from './faz7-helpers.js';
import { bearer, cleanup, createTestApp, resetRateLimits, type TestContext } from './helpers.js';
import {
  adanaMarket,
  customerIn,
  type Market,
  opportunities,
  opportunityIds,
  providerIn,
} from './marketplace-helpers.js';

/**
 * Faz 7 provider coverage (districts, PROVINCE / RADIUS regions, service
 * centre + maximum travel distance) and availability (pause, "bugün müsait
 * değilim", time off, weekly hours), end to end: the settings endpoints
 * and their effect on the live opportunity feed and on dispatch.
 */
describe('Faz 7: coverage and availability (e2e)', () => {
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

  async function centreKm(a: string, b: string): Promise<number> {
    const x = await ctx.prisma.district.findUniqueOrThrow({ where: { id: a } });
    const y = await ctx.prisma.district.findUniqueOrThrow({ where: { id: b } });
    return new HaversineDistanceCalculator().distanceKm(
      { lat: Number(x.latitude), lng: Number(x.longitude) },
      { lat: Number(y.latitude), lng: Number(y.longitude) },
    );
  }

  describe('coverage settings', () => {
    it('starts with the Faz 2 districts, no regions, no centre and no travel limit', async () => {
      const provider = await providerIn(ctx, {
        categoryIds: [m.klimaId],
        districtIds: [m.seyhan, m.cukurova],
      });
      const res = await ctx
        .http()
        .get('/api/v1/providers/me/coverage')
        .set('Authorization', bearer(provider))
        .expect(200);
      const coverage = providerCoverageSchema.parse(res.body);
      expect(coverage.regions).toEqual([]);
      expect(coverage.maxTravelKm).toBeNull();
      expect(coverage.serviceCenter).toBeNull();
      expect(coverage.districts).toHaveLength(1);
      expect(coverage.districts[0]?.province.id).toBe(m.provinceId);
      expect(coverage.districts[0]?.districts.map((d) => d.id).sort()).toEqual(
        [m.seyhan, m.cukurova].sort(),
      );
    });

    it('needs a service centre before a maximum travel distance', async () => {
      const provider = await providerIn(ctx, {
        categoryIds: [m.klimaId],
        districtIds: [m.seyhan],
      });
      const noCentre = await setCoverage(ctx, provider, { maxTravelKm: 20 });
      expect(noCentre.status).toBe(422);
      expect(noCentre.body.code).toBe('SERVICE_CENTER_REQUIRED');

      const ok = await setCoverage(ctx, provider, {
        serviceCenterDistrictId: m.seyhan,
        maxTravelKm: 20,
      }).expect(200);
      const coverage = providerCoverageSchema.parse(ok.body);
      expect(coverage.maxTravelKm).toBe(20);
      expect(coverage.serviceCenter?.district.id).toBe(m.seyhan);
      expect(coverage.serviceCenter?.province.id).toBe(m.provinceId);

      // Removing the centre while a limit is set is refused too.
      const drop = await setCoverage(ctx, provider, { serviceCenterDistrictId: null });
      expect(drop.status).toBe(422);
      expect(drop.body.code).toBe('SERVICE_CENTER_REQUIRED');
      // Both together is fine.
      const cleared = await setCoverage(ctx, provider, {
        serviceCenterDistrictId: null,
        maxTravelKm: null,
      }).expect(200);
      expect(cleared.body.serviceCenter).toBeNull();
      expect(cleared.body.maxTravelKm).toBeNull();

      const unknown = await setCoverage(ctx, provider, { serviceCenterDistrictId: randomUUID() });
      expect(unknown.status).toBe(422);
      expect(unknown.body.code).toBe('DISTRICT_NOT_FOUND');
      // Out of range and empty bodies never reach the service.
      await setCoverage(ctx, provider, { maxTravelKm: 0 }).expect(400);
      await setCoverage(ctx, provider, { maxTravelKm: 501 }).expect(400);
      await setCoverage(ctx, provider, {}).expect(400);
    });

    it('replaces PROVINCE and RADIUS regions and validates them', async () => {
      const provider = await providerIn(ctx, {
        categoryIds: [m.klimaId],
        districtIds: [m.seyhan],
      });
      const res = await setRegions(ctx, provider, [
        { kind: 'PROVINCE', provinceId: m.provinceId },
        { kind: 'RADIUS', centerDistrictId: m.seyhan, radiusKm: 30 },
      ]).expect(200);
      const coverage = providerCoverageSchema.parse(res.body);
      expect(coverage.regions).toHaveLength(2);
      const province = coverage.regions.find((r) => r.kind === 'PROVINCE');
      const radius = coverage.regions.find((r) => r.kind === 'RADIUS');
      expect(province).toMatchObject({ province: { id: m.provinceId }, radiusKm: null });
      expect(radius).toMatchObject({
        province: { id: m.provinceId },
        centerDistrict: { id: m.seyhan },
        radiusKm: 30,
      });
      // The district list is untouched.
      expect(coverage.districts[0]?.districts.map((d) => d.id)).toEqual([m.seyhan]);

      const duplicate = await setRegions(ctx, provider, [
        { kind: 'PROVINCE', provinceId: m.provinceId },
        { kind: 'PROVINCE', provinceId: m.provinceId },
      ]);
      expect(duplicate.status).toBe(400);
      const badRadius = await setRegions(ctx, provider, [
        { kind: 'RADIUS', centerDistrictId: m.seyhan, radiusKm: 0 },
      ]);
      expect(badRadius.status).toBe(400);
      const unknownCentre = await setRegions(ctx, provider, [
        { kind: 'RADIUS', centerDistrictId: randomUUID(), radiusKm: 10 },
      ]);
      expect(unknownCentre.status).toBe(422);
      expect(unknownCentre.body.code).toBe('DISTRICT_NOT_FOUND');
      // A refused call changed nothing.
      const after = await ctx
        .http()
        .get('/api/v1/providers/me/coverage')
        .set('Authorization', bearer(provider))
        .expect(200);
      expect(after.body.regions).toHaveLength(2);

      const cleared = await setRegions(ctx, provider, []).expect(200);
      expect(cleared.body.regions).toEqual([]);
    });

    it('is provider-only', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      await ctx
        .http()
        .get('/api/v1/providers/me/coverage')
        .set('Authorization', bearer(customer))
        .expect(403);
      await ctx
        .http()
        .patch('/api/v1/providers/me/availability-settings')
        .set('Authorization', bearer(customer))
        .send({ acceptingNewJobs: false })
        .expect(403);
      await ctx.http().get('/api/v1/providers/me/coverage').expect(401);
    });
  });

  describe('coverage in matching', () => {
    it('a PROVINCE region covers every district of the province', async () => {
      const categoryId = await newCategory(ctx);
      const provider = await providerIn(ctx, { categoryIds: [categoryId], districtIds: [] });
      await setRegions(ctx, provider, [{ kind: 'PROVINCE', provinceId: m.provinceId }]).expect(200);
      const customer = await customerIn(ctx, kozan);
      const request = await createRequestV2(ctx, customer, { categoryId });
      expect(await opportunityIds(ctx, provider)).toContain(request.id);
      // Wave 1 only reaches REGION providers within 15 km; this one has no
      // service centre (distance unknown), so it is not dispatched yet.
      expect((await dispatchesOf(ctx, request.id)).map((d) => d.providerId)).toEqual([]);
    });

    it('a RADIUS region covers districts whose centre is inside the radius only', async () => {
      const categoryId = await newCategory(ctx);
      const provider = await providerIn(ctx, { categoryIds: [categoryId], districtIds: [] });
      await setRegions(ctx, provider, [
        { kind: 'RADIUS', centerDistrictId: m.seyhan, radiusKm: 15 },
      ]).expect(200);
      expect(await centreKm(m.seyhan, m.cukurova)).toBeLessThan(15);
      expect(await centreKm(m.seyhan, kozan)).toBeGreaterThan(15);

      const near = await createRequestV2(ctx, await customerIn(ctx, m.cukurova), { categoryId });
      const far = await createRequestV2(ctx, await customerIn(ctx, kozan), { categoryId });
      const ids = await opportunityIds(ctx, provider);
      expect(ids).toContain(near.id);
      expect(ids).not.toContain(far.id);
      expect(await detailStatus(ctx, provider, far.id)).toBe(404);
    });

    it('the maximum travel distance hides requests too far from the service centre (TOO_FAR)', async () => {
      const categoryId = await newCategory(ctx);
      const provider = await providerIn(ctx, {
        categoryIds: [categoryId],
        districtIds: [m.seyhan, kozan],
      });
      await setCoverage(ctx, provider, {
        serviceCenterDistrictId: m.seyhan,
        maxTravelKm: 30,
      }).expect(200);
      const inRange = await createRequestV2(ctx, await customerIn(ctx, m.seyhan), { categoryId });
      const tooFar = await createRequestV2(ctx, await customerIn(ctx, kozan), { categoryId });

      const ids = await opportunityIds(ctx, provider);
      expect(ids).toContain(inRange.id);
      expect(ids).not.toContain(tooFar.id);
      expect(await detailStatus(ctx, provider, tooFar.id)).toBe(404);
      const quote = await ctx
        .http()
        .post(`/api/v1/service-requests/${tooFar.id}/quotes`)
        .set('Authorization', bearer(provider))
        .send({ totalMinor: 100000 });
      expect(quote.status).toBe(404);
      expect((await dispatchesOf(ctx, tooFar.id)).map((d) => d.providerId)).not.toContain(
        provider.providerId,
      );
      expect((await dispatchesOf(ctx, inRange.id)).map((d) => d.providerId)).toContain(
        provider.providerId,
      );

      // Raising the limit makes it visible again, live.
      await setCoverage(ctx, provider, { maxTravelKm: 100 }).expect(200);
      expect(await opportunityIds(ctx, provider)).toContain(tooFar.id);
    });

    it('shows an approximate distance from the service centre ("Yaklaşık N km")', async () => {
      const categoryId = await newCategory(ctx);
      const provider = await providerIn(ctx, {
        categoryIds: [categoryId],
        districtIds: [m.seyhan, m.cukurova, saricam],
      });
      const customerSame = await customerIn(ctx, m.seyhan);
      const same = await createRequestV2(ctx, customerSame, { categoryId });

      // No service centre yet: no distance at all (never a made-up number).
      const before = (await opportunities(ctx, provider)).find((o) => o.id === same.id);
      expect(before?.distance).toBeNull();

      await setCoverage(ctx, provider, { serviceCenterDistrictId: m.seyhan }).expect(200);
      const cukurovaReq = await createRequestV2(ctx, await customerIn(ctx, m.cukurova), {
        categoryId,
      });
      const saricamReq = await createRequestV2(ctx, await customerIn(ctx, saricam), {
        categoryId,
      });
      const feed = await opportunities(ctx, provider);
      const byId = new Map(feed.map((o) => [o.id, opportunitySchema.parse(o)]));

      // Same district: 0 km is shown as the minimum, 1 km.
      expect(byId.get(same.id)?.distance).toEqual({ km: 1, approximate: true });
      const cukurovaKm = await centreKm(m.seyhan, m.cukurova);
      expect(cukurovaKm).toBeLessThan(10);
      const shown = byId.get(cukurovaReq.id)?.distance;
      expect(shown).toEqual({ km: roundApproxKm(cukurovaKm), approximate: true });
      // Under 10 km: half-kilometre steps.
      expect(((shown?.km ?? 0.25) * 2) % 1).toBe(0);
      const saricamKm = await centreKm(m.seyhan, saricam);
      expect(saricamKm).toBeGreaterThan(10);
      expect(byId.get(saricamReq.id)?.distance).toEqual({
        km: Math.round(saricamKm),
        approximate: true,
      });

      // The detail view agrees with the list.
      const detail = await ctx
        .http()
        .get(`/api/v1/providers/me/opportunities/${saricamReq.id}`)
        .set('Authorization', bearer(provider))
        .expect(200);
      expect(detail.body.distance).toEqual({ km: Math.round(saricamKm), approximate: true });
    });
  });

  describe('availability', () => {
    async function availabilityOf(provider: { tokens: { accessToken: string } }) {
      const res = await ctx
        .http()
        .get('/api/v1/providers/me/availability-settings')
        .set('Authorization', `Bearer ${provider.tokens.accessToken}`)
        .expect(200);
      return providerAvailabilitySchema.parse(res.body);
    }

    it('defaults to available in Europe/Istanbul', async () => {
      const provider = await providerIn(ctx, { categoryIds: [m.klimaId], districtIds: [m.seyhan] });
      const a = await availabilityOf(provider);
      expect(a).toMatchObject({
        state: 'AVAILABLE',
        receivesNewJobs: true,
        acceptingNewJobs: true,
        unavailableUntil: null,
        weeklyHours: [],
        timeOff: [],
        timeZone: 'Europe/Istanbul',
      });
    });

    it('"Yeni iş alma" pauses: no feed, no dispatch, and NOW "müsaitim" is switched off', async () => {
      const categoryId = await newCategory(ctx);
      const provider = await providerIn(ctx, {
        categoryIds: [categoryId],
        districtIds: [m.seyhan],
        nowEnabled: true,
        isAvailableNow: true,
      });
      const res = await patchAvailability(ctx, provider, { acceptingNewJobs: false }).expect(200);
      const paused = providerAvailabilitySchema.parse(res.body);
      expect(paused).toMatchObject({
        state: 'PAUSED',
        receivesNewJobs: false,
        acceptingNewJobs: false,
        isAvailableNow: false,
      });

      const customer = await customerIn(ctx, m.seyhan);
      const request = await createRequestV2(ctx, customer, { categoryId });
      expect(await opportunityIds(ctx, provider)).not.toContain(request.id);
      expect(await detailStatus(ctx, provider, request.id)).toBe(404);
      expect(await dispatchesOf(ctx, request.id)).toEqual([]);
      expect(
        await ctx.prisma.notification.count({
          where: { userId: provider.userId, type: 'service_request.new_opportunity' },
        }),
      ).toBe(0);

      const resumed = await patchAvailability(ctx, provider, { acceptingNewJobs: true }).expect(
        200,
      );
      expect(resumed.body.state).toBe('AVAILABLE');
      expect(await opportunityIds(ctx, provider)).toContain(request.id);
    });

    it('"Bugün müsait değilim" lasts until the end of the local day', async () => {
      const categoryId = await newCategory(ctx);
      const provider = await providerIn(ctx, {
        categoryIds: [categoryId],
        districtIds: [m.seyhan],
      });
      const res = await patchAvailability(ctx, provider, { availableToday: false }).expect(200);
      const a = providerAvailabilitySchema.parse(res.body);
      expect(a.state).toBe('UNAVAILABLE_TODAY');
      expect(a.receivesNewJobs).toBe(false);
      expect(a.unavailableUntil).not.toBeNull();
      const until = new Date(a.unavailableUntil ?? 0);
      expect(until.getTime()).toBeGreaterThan(Date.now());
      expect(until.getTime() - Date.now()).toBeLessThanOrEqual(24 * 3600_000);
      // The end of the day in Istanbul (UTC+3): 23:59:59.999 local = 20:59:59.999 UTC,
      // or local midnight, depending on how the day is closed.
      const localTime = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Istanbul',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(until);
      expect(['23:59', '00:00']).toContain(localTime);

      const request = await createRequestV2(ctx, await customerIn(ctx, m.seyhan), { categoryId });
      expect(await opportunityIds(ctx, provider)).not.toContain(request.id);
      expect(await dispatchesOf(ctx, request.id)).toEqual([]);

      const back = await patchAvailability(ctx, provider, { availableToday: true }).expect(200);
      expect(back.body).toMatchObject({ state: 'AVAILABLE', unavailableUntil: null });
      expect(await opportunityIds(ctx, provider)).toContain(request.id);
    });

    it('time off: current leave stops new work, future leave does not, cancel restores', async () => {
      const categoryId = await newCategory(ctx);
      const provider = await providerIn(ctx, {
        categoryIds: [categoryId],
        districtIds: [m.seyhan],
      });
      const now = Date.now();

      const past = await addTimeOff(
        ctx,
        provider,
        new Date(now - 2 * 86400_000),
        new Date(now - 3600_000),
      );
      expect(past.status).toBe(422);
      expect(past.body.code).toBe('TIME_OFF_IN_PAST');
      const reversed = await addTimeOff(
        ctx,
        provider,
        new Date(now + 7200_000),
        new Date(now + 3600_000),
      );
      expect(reversed.status).toBe(400);

      // Future leave: still available now.
      const future = await addTimeOff(
        ctx,
        provider,
        new Date(now + 5 * 86400_000),
        new Date(now + 6 * 86400_000),
        'Bayram',
      ).expect(201);
      const f = providerAvailabilitySchema.parse(future.body);
      expect(f.state).toBe('AVAILABLE');
      expect(f.timeOff).toHaveLength(1);
      expect(f.timeOff[0]).toMatchObject({ current: false, note: 'Bayram' });
      const r1 = await createRequestV2(ctx, await customerIn(ctx, m.seyhan), { categoryId });
      expect((await dispatchesOf(ctx, r1.id)).map((d) => d.providerId)).toEqual([
        provider.providerId,
      ]);

      // Current leave.
      const current = await addTimeOff(
        ctx,
        provider,
        new Date(now - 3600_000),
        new Date(now + 86400_000),
      ).expect(201);
      const c = providerAvailabilitySchema.parse(current.body);
      expect(c.state).toBe('TIME_OFF');
      expect(c.receivesNewJobs).toBe(false);
      const leave = c.timeOff.find((t) => t.current);
      if (!leave) throw new Error('current leave missing');

      const r2 = await createRequestV2(ctx, await customerIn(ctx, m.seyhan), { categoryId });
      expect(await dispatchesOf(ctx, r2.id)).toEqual([]);
      const ids = await opportunityIds(ctx, provider);
      expect(ids).not.toContain(r2.id);
      expect(ids).not.toContain(r1.id);

      const cancelled = await ctx
        .http()
        .delete(`/api/v1/providers/me/time-off/${leave.id}`)
        .set('Authorization', bearer(provider))
        .expect(200);
      expect(cancelled.body.state).toBe('AVAILABLE');
      expect(cancelled.body.timeOff).toHaveLength(1);
      expect(await opportunityIds(ctx, provider)).toEqual(expect.arrayContaining([r1.id, r2.id]));

      const again = await ctx
        .http()
        .delete(`/api/v1/providers/me/time-off/${leave.id}`)
        .set('Authorization', bearer(provider));
      expect(again.status).toBe(404);
      expect(again.body.code).toBe('TIME_OFF_NOT_FOUND');

      // Another provider cannot cancel someone else's leave.
      const other = await providerIn(ctx, { categoryIds: [categoryId], districtIds: [m.seyhan] });
      const foreign = await ctx
        .http()
        .delete(`/api/v1/providers/me/time-off/${f.timeOff[0]?.id}`)
        .set('Authorization', bearer(other));
      expect(foreign.status).toBe(404);
    });

    it('weekly hours: outside hours still receives quote requests but no NOW dispatch', async () => {
      const categoryId = await newCategory(ctx, { supportsNow: true });
      const provider = await providerIn(ctx, {
        categoryIds: [categoryId],
        districtIds: [m.seyhan],
        nowEnabled: true,
        isAvailableNow: true,
      });
      const today = istanbulWeekday();
      const otherDay = (today % 7) + 1;
      const overlap = await ctx
        .http()
        .put('/api/v1/providers/me/weekly-hours')
        .set('Authorization', bearer(provider))
        .send({
          hours: [
            { weekday: otherDay, startMinute: 540, endMinute: 720 },
            { weekday: otherDay, startMinute: 600, endMinute: 800 },
          ],
        });
      expect(overlap.status).toBe(400);

      const res = await ctx
        .http()
        .put('/api/v1/providers/me/weekly-hours')
        .set('Authorization', bearer(provider))
        .send({ hours: [{ weekday: otherDay, startMinute: 0, endMinute: 1440 }] })
        .expect(200);
      const a = providerAvailabilitySchema.parse(res.body);
      expect(a.state).toBe('OUTSIDE_HOURS');
      expect(a.receivesNewJobs).toBe(true);
      expect(a.weeklyHours).toEqual([{ weekday: otherDay, startMinute: 0, endMinute: 1440 }]);

      const customer = await customerIn(ctx, m.seyhan);
      const quoteReq = await createRequestV2(ctx, customer, { categoryId });
      const nowReq = await createRequestV2(ctx, customer, {
        categoryId,
        type: 'NOW',
        budgetMinor: null,
      });
      expect((await dispatchesOf(ctx, quoteReq.id)).map((d) => d.providerId)).toEqual([
        provider.providerId,
      ]);
      expect(await dispatchesOf(ctx, nowReq.id)).toEqual([]);
      expect(await opportunityIds(ctx, provider, '?type=NOW')).not.toContain(nowReq.id);

      // Hours covering today: NOW reaches the provider again.
      const allDay = await ctx
        .http()
        .put('/api/v1/providers/me/weekly-hours')
        .set('Authorization', bearer(provider))
        .send({ hours: [{ weekday: today, startMinute: 0, endMinute: 1440 }] })
        .expect(200);
      expect(allDay.body.state).toBe('AVAILABLE');
      expect(await opportunityIds(ctx, provider, '?type=NOW')).toContain(nowReq.id);

      const flexible = await ctx
        .http()
        .put('/api/v1/providers/me/weekly-hours')
        .set('Authorization', bearer(provider))
        .send({ hours: [] })
        .expect(200);
      expect(flexible.body).toMatchObject({ state: 'AVAILABLE', weeklyHours: [] });
    });

    it('the provider home reflects availability and live counts', async () => {
      const categoryId = await newCategory(ctx);
      const provider = await providerIn(ctx, {
        categoryIds: [categoryId],
        districtIds: [m.seyhan],
      });
      await createRequestV2(ctx, await customerIn(ctx, m.seyhan), { categoryId });
      const res = await ctx
        .http()
        .get('/api/v1/providers/me/home')
        .set('Authorization', bearer(provider))
        .expect(200);
      const home = providerHomeSchema.parse(res.body);
      expect(home.availability.state).toBe('AVAILABLE');
      expect(home.openOpportunities).toBeGreaterThanOrEqual(1);
      expect(home.profileCompleteness.percent).toBeGreaterThanOrEqual(0);

      await patchAvailability(ctx, provider, { acceptingNewJobs: false }).expect(200);
      const paused = await ctx
        .http()
        .get('/api/v1/providers/me/home')
        .set('Authorization', bearer(provider))
        .expect(200);
      expect(providerHomeSchema.parse(paused.body).availability.state).toBe('PAUSED');
    });
  });
});
