import { Test } from '@nestjs/testing';

import { API_ENV } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { testEnv } from '../testing/test-env.js';
import { HealthService } from './health.service.js';

async function createService(db: () => Promise<void>, redis: () => Promise<void>) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      HealthService,
      { provide: API_ENV, useValue: testEnv() },
      { provide: PrismaService, useValue: { ping: db } },
      { provide: RedisService, useValue: { ping: redis } },
    ],
  }).compile();
  return moduleRef.get(HealthService);
}

const up = () => Promise.resolve();
const fail = (message: string) => () => Promise.reject(new Error(message));

describe('HealthService', () => {
  it('reports ok when every dependency is up', async () => {
    const service = await createService(up, up);
    const result = await service.check();
    expect(result.status).toBe('ok');
    expect(result.version).toBe('0.0.0-test');
    expect(result.checks.database.status).toBe('up');
    expect(result.checks.redis.status).toBe('up');
  });

  it('reports degraded when only Redis is down', async () => {
    const service = await createService(up, fail('ECONNREFUSED'));
    const result = await service.check();
    expect(result.status).toBe('degraded');
    expect(result.checks.redis).toEqual({ status: 'down', error: 'ECONNREFUSED' });
  });

  it('reports down when the database is down', async () => {
    const service = await createService(fail('db unreachable\nstack details'), up);
    const result = await service.check();
    expect(result.status).toBe('down');
    expect(result.checks.database.error).toBe('db unreachable');
  });
});
