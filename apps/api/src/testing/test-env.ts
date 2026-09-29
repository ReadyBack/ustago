import { type ApiEnv, loadApiEnv } from '../config/env.js';

/** A valid env for tests that never touch real services. */
export function testEnv(overrides: Record<string, string> = {}): ApiEnv {
  return loadApiEnv({
    NODE_ENV: 'test',
    APP_VERSION: '0.0.0-test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379',
    API_SWAGGER_ENABLED: 'false',
    ...overrides,
  });
}
