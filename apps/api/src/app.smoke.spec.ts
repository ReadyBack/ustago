import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { healthResponseSchema } from '@ustago/validation';
import request from 'supertest';

import { AppModule } from './app.module.js';
import { setupApp } from './app.setup.js';
import { API_ENV } from './config/env.js';
import { PrismaService } from './prisma/prisma.service.js';
import { RedisService } from './redis/redis.service.js';
import { testEnv } from './testing/test-env.js';

/** Boots the whole app with stubbed dependencies: no Docker needed. */
describe('API smoke', () => {
  let app: INestApplication;
  const env = testEnv();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(API_ENV)
      .useValue(env)
      .overrideProvider(PrismaService)
      .useValue({ ping: () => Promise.resolve() })
      .overrideProvider(RedisService)
      .useValue({ ping: () => Promise.resolve() })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    setupApp(app, env);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health returns a valid health body', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(healthResponseSchema.parse(res.body).status).toBe('ok');
  });

  it('GET /api/v1/health/live returns ok', async () => {
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(200, { status: 'ok' });
  });

  it('unknown routes use the standard error format', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nope').expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND', path: '/api/v1/nope' });
  });
});
