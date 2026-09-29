import { describe, expect, it } from 'vitest';

import { apiEnvSchema } from './api-env.js';
import { EnvValidationError, parseEnv } from './parse-env.js';

const validEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'test-only-secret-that-is-long-enough-123',
};

describe('apiEnvSchema', () => {
  it('applies defaults', () => {
    const env = parseEnv(apiEnvSchema, validEnv);
    expect(env.API_PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_CORS_ORIGINS).toEqual(['http://localhost:3001']);
    expect(env.API_SWAGGER_ENABLED).toBe(true);
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(env.AUTH_REFRESH_TTL_DAYS).toBe(30);
  });

  it('splits CORS origins', () => {
    const env = parseEnv(apiEnvSchema, {
      ...validEnv,
      API_CORS_ORIGINS: 'http://a.test, http://b.test',
    });
    expect(env.API_CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });

  it('fails fast without leaking values', () => {
    try {
      parseEnv(apiEnvSchema, { DATABASE_URL: 'mysql://secret-password@host/db' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const message = (error as EnvValidationError).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('REDIS_URL');
      expect(message).toContain('JWT_ACCESS_SECRET');
      expect(message).not.toContain('secret-password');
    }
  });

  it('rejects a short JWT secret', () => {
    expect(apiEnvSchema.safeParse({ ...validEnv, JWT_ACCESS_SECRET: 'short' }).success).toBe(false);
  });

  it('rejects a session lifetime shorter than the refresh token lifetime', () => {
    const result = apiEnvSchema.safeParse({
      ...validEnv,
      AUTH_REFRESH_TTL_DAYS: '30',
      AUTH_SESSION_MAX_DAYS: '7',
    });
    expect(result.success).toBe(false);
  });

  it('rejects example secrets and wildcard CORS in production', () => {
    const result = apiEnvSchema.safeParse({
      ...validEnv,
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'change-me-local-only-jwt-secret-000000',
      API_CORS_ORIGINS: '*',
    });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((issue) => issue.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['JWT_ACCESS_SECRET', 'API_CORS_ORIGINS']));
  });
});
