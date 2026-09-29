import { randomUUID } from 'node:crypto';

import {
  bearer,
  cleanup,
  createTestApp,
  phoneLogin,
  resetRateLimits,
  type TestContext,
} from './helpers.js';

describe('Push devices follow the session lifecycle (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetRateLimits(ctx, 'rl:otp:*');
  });

  afterAll(async () => {
    await cleanup(ctx);
    await ctx.app.close();
  });

  const register = async (auth: string) => {
    const pushToken = `ExponentPushToken[${randomUUID()}]`;
    const res = await ctx
      .http()
      .post('/api/v1/me/devices')
      .set('Authorization', auth)
      .send({ platform: 'ANDROID', pushProvider: 'EXPO', pushToken })
      .expect(201);
    return { id: res.body.id as string, pushToken };
  };

  it('logout clears the push token of that session’s device only', async () => {
    const phone = (await phoneLogin(ctx)).user.phone ?? '';
    const a = await phoneLogin(ctx, phone);
    const b = await phoneLogin(ctx, phone);
    const deviceA = await register(bearer(a));
    const deviceB = await register(bearer(b));

    await ctx.http().post('/api/v1/auth/logout').set('Authorization', bearer(a)).expect(204);
    const [rowA, rowB] = await Promise.all([
      ctx.prisma.device.findUniqueOrThrow({ where: { id: deviceA.id } }),
      ctx.prisma.device.findUniqueOrThrow({ where: { id: deviceB.id } }),
    ]);
    expect(rowA).toMatchObject({ pushToken: null });
    expect(rowA.revokedAt).not.toBeNull();
    expect(rowB).toMatchObject({ pushToken: deviceB.pushToken, revokedAt: null });
  });

  it('logout-all clears every device of the user', async () => {
    const auth = await phoneLogin(ctx);
    const other = await phoneLogin(ctx, auth.user.phone ?? '');
    await register(bearer(auth));
    await register(bearer(other));
    await ctx.http().post('/api/v1/auth/logout-all').set('Authorization', bearer(auth)).expect(204);
    const live = await ctx.prisma.device.count({
      where: { userId: auth.user.id, OR: [{ revokedAt: null }, { pushToken: { not: null } }] },
    });
    expect(live).toBe(0);
  });
});
