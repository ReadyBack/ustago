import { HttpException, Logger } from '@nestjs/common';

import type { RedisService } from '../redis/redis.service.js';
import { testEnv } from '../testing/test-env.js';
import { RateLimitService } from './rate-limit.service.js';

/** Minimal in-memory stand-in for the Redis MULTI used by the service. */
function fakeRedis() {
  const counters = new Map<string, number>();
  const keys: string[] = [];
  const client = {
    multi() {
      let key = '';
      const chain = {
        incr(k: string) {
          key = k;
          keys.push(k);
          return chain;
        },
        expire: () => chain,
        ttl: () => chain,
        exec: () => {
          const next = (counters.get(key) ?? 0) + 1;
          counters.set(key, next);
          return Promise.resolve([
            [null, next],
            [null, 1],
            [null, 42],
          ]);
        },
      };
      return chain;
    },
  };
  return { redis: { connected: () => Promise.resolve(client) } as unknown as RedisService, keys };
}

describe('RateLimitService', () => {
  const env = testEnv({ AUTH_RATE_LIMIT_MAX: '2', AUTH_RATE_LIMIT_WINDOW_SECONDS: '60' });

  it('allows requests up to the limit, then blocks with 429', async () => {
    const service = new RateLimitService(fakeRedis().redis, env);
    await service.enforce({ bucket: 'login:ip', subject: '1.2.3.4' });
    await service.enforce({ bucket: 'login:ip', subject: '1.2.3.4' });
    try {
      await service.enforce({ bucket: 'login:ip', subject: '1.2.3.4' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'RATE_LIMITED',
        details: { retryAfterSeconds: 42 },
      });
    }
  });

  it('counts subjects separately and never stores them in clear text', async () => {
    const { redis, keys } = fakeRedis();
    const service = new RateLimitService(redis, env);
    await service.enforce({ bucket: 'login:email', subject: 'ayse@example.com' });
    await service.enforce({ bucket: 'login:email', subject: 'ali@example.com' });
    await service.enforce({ bucket: 'login:email', subject: 'ali@example.com' });
    expect(keys.join()).not.toContain('example.com');
  });

  it('fails open when Redis is unavailable', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const broken = {
      connected: () => Promise.reject(new Error('down')),
    } as unknown as RedisService;
    const service = new RateLimitService(broken, env);
    await expect(service.hit('login:ip', 'x')).resolves.toMatchObject({ allowed: true });
  });
});
