import { RedisService } from '../src/redis/redis.service.js';
import { cleanup, createTestApp, RUN_ID, type TestContext } from './helpers.js';

describe('Auth rate limiting (e2e, real Redis)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ AUTH_RATE_LIMIT_MAX: '3', AUTH_RATE_LIMIT_WINDOW_SECONDS: '30' });
    // Other suites log in from the same IP; start this one with clean counters.
    const redis = await ctx.app.get(RedisService).connected();
    const keys = await redis.keys('rl:login:*');
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await cleanup(ctx);
    await ctx.app.close();
  });

  it('returns 429 after too many login attempts for one e-mail', async () => {
    const email = `e2e-${RUN_ID}-bruteforce@ustago.test`;
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email, password: 'yanlis-sifre-000' });
      statuses.push(res.status);
      if (res.status === 429) {
        expect(res.body.code).toBe('RATE_LIMITED');
        expect(res.body.details.retryAfterSeconds).toBeGreaterThan(0);
      }
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
  });
});
