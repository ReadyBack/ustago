import { districtSchema, provinceSchema, serviceCategorySchema } from '@ustago/validation';
import { z } from 'zod';

import {
  bearer,
  cleanup,
  createStaffUser,
  createTestApp,
  registerUser,
  RUN_ID,
  type TestContext,
} from './helpers.js';

describe('Categories and locations (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await cleanup(ctx);
    await ctx.app.close();
  });

  it('lists all 81 provinces publicly', async () => {
    const res = await ctx.http().get('/api/v1/locations/provinces').expect(200);
    const provinces = z.array(provinceSchema).parse(res.body);
    expect(provinces).toHaveLength(81);
    expect(provinces[33]).toMatchObject({ id: 34, name: 'İstanbul', slug: 'istanbul' });
  });

  it('lists a province’s districts', async () => {
    const res = await ctx.http().get('/api/v1/locations/provinces/34/districts').expect(200);
    const districts = z.array(districtSchema).parse(res.body);
    expect(districts.map((d) => d.slug)).toContain('kadikoy');
    await ctx.http().get('/api/v1/locations/provinces/82/districts').expect(400);
  });

  it('only admins open or close provinces', async () => {
    const customer = await registerUser(ctx);
    const admin = await createStaffUser(ctx, ['ADMIN']);
    await ctx
      .http()
      .patch('/api/v1/locations/provinces/81')
      .set('Authorization', bearer(customer))
      .send({ isActive: true })
      .expect(403);
    const before = await ctx.prisma.province.findUniqueOrThrow({ where: { id: 81 } });
    await ctx
      .http()
      .patch('/api/v1/locations/provinces/81')
      .set('Authorization', bearer(admin))
      .send({ isActive: !before.isActive })
      .expect(200);
    await ctx.prisma.province.update({ where: { id: 81 }, data: { isActive: before.isActive } });
  });

  it('lists active categories publicly', async () => {
    const res = await ctx.http().get('/api/v1/categories').expect(200);
    const slugs = (res.body as { slug: string }[]).map((c) => c.slug);
    expect(slugs).toEqual(expect.arrayContaining(['klima', 'elektrik', 'su-tesisati', 'cilingir']));
    await ctx.http().get('/api/v1/categories/cilingir').expect(200);
    await ctx.http().get('/api/v1/categories/yok-boyle-bir-sey').expect(404);
  });

  it('admins manage categories; others cannot', async () => {
    const admin = await createStaffUser(ctx, ['ADMIN']);
    const provider = await registerUser(ctx, { accountType: 'PROVIDER' });
    const slug = `e2e-${RUN_ID}-kombi`;

    await ctx
      .http()
      .post('/api/v1/categories')
      .set('Authorization', bearer(provider))
      .send({ slug, name: 'Kombi' })
      .expect(403);

    const created = await ctx
      .http()
      .post('/api/v1/categories')
      .set('Authorization', bearer(admin))
      .send({ slug, name: 'Kombi', supportsNow: true })
      .expect(201);
    const category = serviceCategorySchema.parse(created.body);

    await ctx
      .http()
      .post('/api/v1/categories')
      .set('Authorization', bearer(admin))
      .send({ slug, name: 'Kombi' })
      .expect(409);

    await ctx
      .http()
      .patch(`/api/v1/categories/${category.id}`)
      .set('Authorization', bearer(admin))
      .send({ isActive: false })
      .expect(200);
    await ctx.http().get(`/api/v1/categories/${slug}`).expect(404);
  });
});
