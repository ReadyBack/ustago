import { addressSchema } from '@ustago/validation';
import { z } from 'zod';

import { bearer, cleanup, createTestApp, registerUser, type TestContext } from './helpers.js';

describe('Customer addresses (e2e)', () => {
  let ctx: TestContext;
  let kadikoy: string;
  let cankaya: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    kadikoy = (
      await ctx.prisma.district.findFirstOrThrow({ where: { provinceId: 34, slug: 'kadikoy' } })
    ).id;
    cankaya = (
      await ctx.prisma.district.findFirstOrThrow({ where: { provinceId: 6, slug: 'cankaya' } })
    ).id;
  });

  afterAll(async () => {
    await cleanup(ctx);
    await ctx.app.close();
  });

  const address = (overrides: Record<string, unknown> = {}) => ({
    label: 'Ev',
    provinceId: 34,
    districtId: kadikoy,
    neighborhood: 'Caferağa',
    addressLine: 'Moda Caddesi No: 10',
    buildingNo: '10',
    apartmentNo: '5',
    postalCode: '34710',
    instructions: 'Zili çalmayın, arayın.',
    latitude: 40.987,
    longitude: 29.025,
    ...overrides,
  });

  async function customer() {
    const auth = await registerUser(ctx);
    const token = bearer(auth);
    return {
      token,
      create: (body: Record<string, unknown> = address()) =>
        ctx.http().post('/api/v1/me/addresses').set('Authorization', token).send(body),
      list: async () =>
        z
          .array(addressSchema)
          .parse(
            (await ctx.http().get('/api/v1/me/addresses').set('Authorization', token).expect(200))
              .body,
          ),
    };
  }

  it('makes the first address the default and keeps exactly one default', async () => {
    const me = await customer();
    const first = addressSchema.parse((await me.create().expect(201)).body);
    expect(first).toMatchObject({
      isDefault: true,
      province: { id: 34, name: 'İstanbul' },
      district: { name: 'Kadıköy' },
      latitude: 40.987,
    });

    const second = addressSchema.parse(
      (await me.create(address({ label: 'İş', isDefault: false })).expect(201)).body,
    );
    expect(second.isDefault).toBe(false);

    const third = addressSchema.parse(
      (await me.create(address({ label: 'Yazlık', isDefault: true })).expect(201)).body,
    );
    expect(third.isDefault).toBe(true);
    const list = await me.list();
    expect(list.filter((a) => a.isDefault).map((a) => a.id)).toEqual([third.id]);
    expect(list[0]?.id).toBe(third.id);

    await ctx
      .http()
      .put(`/api/v1/me/addresses/${second.id}/default`)
      .set('Authorization', me.token)
      .expect(200);
    expect((await me.list()).filter((a) => a.isDefault).map((a) => a.id)).toEqual([second.id]);
  });

  it('moves the default to the newest remaining address on delete', async () => {
    const me = await customer();
    const a = (await me.create().expect(201)).body;
    const b = (await me.create(address({ label: 'B' })).expect(201)).body;
    const c = (await me.create(address({ label: 'C' })).expect(201)).body;
    await ctx
      .http()
      .delete(`/api/v1/me/addresses/${a.id}`)
      .set('Authorization', me.token)
      .expect(204);
    const list = await me.list();
    expect(list.map((x) => x.id).sort()).toEqual([b.id, c.id].sort());
    expect(list.find((x) => x.isDefault)?.id).toBe(c.id);

    // Soft-deleted rows stay for history but are gone for the customer.
    await ctx.http().get(`/api/v1/me/addresses/${a.id}`).set('Authorization', me.token).expect(404);
    const row = await ctx.prisma.address.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.deletedAt).not.toBeNull();
  });

  it('never reveals or changes another customer’s address (IDOR)', async () => {
    const owner = await customer();
    const other = await customer();
    const target = (await owner.create().expect(201)).body;
    const attempts = [
      () => ctx.http().get(`/api/v1/me/addresses/${target.id}`),
      () => ctx.http().patch(`/api/v1/me/addresses/${target.id}`).send({ label: 'Hack' }),
      () => ctx.http().put(`/api/v1/me/addresses/${target.id}/default`),
      () => ctx.http().delete(`/api/v1/me/addresses/${target.id}`),
    ];
    for (const attempt of attempts) {
      const res = await attempt().set('Authorization', other.token);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ADDRESS_NOT_FOUND');
    }
    expect(await other.list()).toEqual([]);
    const untouched = await ctx.prisma.address.findUniqueOrThrow({ where: { id: target.id } });
    expect(untouched).toMatchObject({ label: 'Ev', deletedAt: null, isDefault: true });
    await ctx.http().get('/api/v1/me/addresses').expect(401);
  });

  it('checks that the district belongs to the province', async () => {
    const me = await customer();
    const res = await me.create(address({ districtId: cankaya })).expect(422);
    expect(res.body.code).toBe('DISTRICT_PROVINCE_MISMATCH');

    const created = (await me.create().expect(201)).body;
    const patch = await ctx
      .http()
      .patch(`/api/v1/me/addresses/${created.id}`)
      .set('Authorization', me.token)
      .send({ provinceId: 6, districtId: kadikoy })
      .expect(422);
    expect(patch.body.code).toBe('DISTRICT_PROVINCE_MISMATCH');

    const moved = await ctx
      .http()
      .patch(`/api/v1/me/addresses/${created.id}`)
      .set('Authorization', me.token)
      .send({ provinceId: 6, districtId: cankaya })
      .expect(200);
    expect(moved.body.province.name).toBe('Ankara');
  });

  it.each([
    ['a latitude out of range', { latitude: 91 }],
    ['a longitude out of range', { longitude: -181 }],
    ['only one coordinate', { latitude: 41, longitude: undefined }],
    ['a bad postal code', { postalCode: '3471' }],
    ['unknown fields', { userId: '00000000-0000-7000-8000-000000000000' }],
    ['a province outside 1-81', { provinceId: 82 }],
  ])('rejects %s', async (_label, overrides) => {
    const me = await customer();
    const res = await me.create(address(overrides)).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('keeps one default under concurrent "set default" calls', async () => {
    const me = await customer();
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1)
      ids.push((await me.create(address({ label: `A${i}` })).expect(201)).body.id);
    const results = await Promise.all(
      ids.map((id) =>
        ctx.http().put(`/api/v1/me/addresses/${id}/default`).set('Authorization', me.token),
      ),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect((await me.list()).filter((a) => a.isDefault)).toHaveLength(1);
  });

  it('is backed by a database rule allowing one live default per user', async () => {
    const me = await customer();
    const a = (await me.create().expect(201)).body;
    const b = (await me.create(address({ label: 'B' })).expect(201)).body;
    expect(a.isDefault).toBe(true);
    await expect(
      ctx.prisma.address.update({ where: { id: b.id }, data: { isDefault: true } }),
    ).rejects.toThrow();
  });
});
