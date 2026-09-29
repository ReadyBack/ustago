import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { healthResponseSchema } from '@ustago/validation';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/app.setup.js';
import { API_ENV, type ApiEnv } from '../src/config/env.js';

/**
 * Runs against the real PostgreSQL and Redis from docker-compose (or CI
 * service containers). Requires DATABASE_URL and REDIS_URL.
 */
const rootEnv = resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

describe('Health (e2e, real services)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: ['error'] });
    setupApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports the database and Redis as up', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    const body = healthResponseSchema.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.checks.database.status).toBe('up');
    expect(body.checks.redis.status).toBe('up');
  });
});
