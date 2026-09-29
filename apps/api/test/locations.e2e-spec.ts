import { districtSchema, provinceCategorySettingSchema } from '@ustago/validation';
import { z } from 'zod';

import { seedReferenceData } from '../src/seed/seed-reference.js';
import {
  bearer,
  cleanup,
  createStaffUser,
  createTestApp,
  registerUser,
  RUN_ID,
  type TestContext,
} from './helpers.js';

describe('Türkiye locations and province × category settings (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await cleanup(ctx);
    await ctx.app.close();
  });

  it('has all 973 districts across the 81 provinces', async () => {
    const perProvince = await ctx.prisma.district.groupBy({
      by: ['provinceId'],
      _count: { _all: true },
    });
    expect(perProvince).toHaveLength(81);
    expect(perProvince.reduce((sum, p) => sum + p._count._all, 0)).toBeGreaterThanOrEqual(973);
    expect(perProvince.every((p) => p._count._all > 0)).toBe(true);
  });

  it('serves every province’s districts with Turkish names and ASCII slugs', async () => {
    const res = await ctx.http().get('/api/v1/locations/provinces/63/districts').expect(200);
    const districts = z.array(districtSchema).parse(res.body);
    expect(districts.map((d) => d.name)).toEqual(
      expect.arrayContaining(['Eyyübiye', 'Haliliye', 'Karaköprü', 'Siverek']),
    );
    expect(districts).toHaveLength(13);
    for (const d of districts) expect(d.slug).toMatch(/^[a-z0-9-]+$/);
  });

  it('re-running the seed adds nothing', async () => {
    const result = await seedReferenceData(ctx.prisma);
    expect(result).toEqual({ provinces: 0, districts: 0, categories: 0 });
  });

  it('lets only admins include inactive districts and categories', async () => {
    const customer = bearer(await registerUser(ctx));
    for (const path of ['districts', 'categories']) {
      await ctx
        .http()
        .get(`/api/v1/locations/provinces/1/${path}`)
        .query({ includeInactive: 'true' })
        .expect(403);
      await ctx
        .http()
        .get(`/api/v1/locations/provinces/1/${path}`)
        .query({ includeInactive: 'true' })
        .set('Authorization', customer)
        .expect(403);
    }
  });

  describe('province × category', () => {
    let admin: string;
    let nowCategory: string;
    let plainCategory: string;

    beforeAll(async () => {
      admin = bearer(await createStaffUser(ctx, ['ADMIN']));
      nowCategory = (
        await ctx.prisma.serviceCategory.create({
          data: { slug: `e2e-${RUN_ID}-pc-now`, name: `E2E PC NOW ${RUN_ID}`, supportsNow: true },
        })
      ).id;
      plainCategory = (
        await ctx.prisma.serviceCategory.create({
          data: { slug: `e2e-${RUN_ID}-pc-plain`, name: `E2E PC ${RUN_ID}`, supportsNow: false },
        })
      ).id;
    });

    const put = (categoryId: string, body: Record<string, boolean>, auth = admin) =>
      ctx
        .http()
        .put(`/api/v1/locations/provinces/1/categories/${categoryId}`)
        .set('Authorization', auth)
        .send(body);

    const settingFor = async (categoryId: string, includeInactive = false) => {
      const req = ctx.http().get('/api/v1/locations/provinces/1/categories');
      if (includeInactive) req.query({ includeInactive: 'true' }).set('Authorization', admin);
      const list = z.array(provinceCategorySettingSchema).parse((await req.expect(200)).body);
      return list.find((s) => s.category.id === categoryId);
    };

    it('follows the category defaults until an admin overrides them', async () => {
      expect(await settingFor(nowCategory)).toMatchObject({
        isActive: true,
        nowEnabled: true,
        source: 'DEFAULT',
      });
      expect(await settingFor(plainCategory)).toMatchObject({ nowEnabled: false });
    });

    it('closes a category in one province and audits the change', async () => {
      const res = await put(nowCategory, { isActive: false, nowEnabled: false }).expect(200);
      expect(res.body).toMatchObject({ isActive: false, nowEnabled: false, source: 'OVERRIDE' });
      expect(await settingFor(nowCategory)).toBeUndefined();
      expect(await settingFor(nowCategory, true)).toMatchObject({ isActive: false });
      const audit = await ctx.prisma.auditLog.count({
        where: { action: 'province_category.updated', entityId: `1:${nowCategory}` },
      });
      expect(audit).toBe(1);

      await put(nowCategory, { isActive: true, nowEnabled: false }).expect(200);
      expect(await settingFor(nowCategory)).toMatchObject({ isActive: true, nowEnabled: false });
    });

    it('refuses NOW for a category that does not support it', async () => {
      const res = await put(plainCategory, { isActive: true, nowEnabled: true }).expect(422);
      expect(res.body.code).toBe('NOW_CATEGORY_NOT_SUPPORTED');
      const invalid = await put(nowCategory, { isActive: false, nowEnabled: true }).expect(400);
      expect(invalid.body.code).toBe('VALIDATION_FAILED');
    });

    it('is admin-only', async () => {
      const customer = bearer(await registerUser(ctx));
      await put(nowCategory, { isActive: true, nowEnabled: true }, customer).expect(403);
      await ctx
        .http()
        .put(`/api/v1/locations/provinces/1/categories/${nowCategory}`)
        .send({ isActive: true, nowEnabled: true })
        .expect(401);
    });
  });
});
