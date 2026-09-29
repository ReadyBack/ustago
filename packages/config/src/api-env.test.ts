import { describe, expect, it } from 'vitest';

import { apiEnvSchema } from './api-env.js';
import { EnvValidationError, parseEnv } from './parse-env.js';

const validEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
};

describe('apiEnvSchema', () => {
  it('applies defaults', () => {
    const env = parseEnv(apiEnvSchema, validEnv);
    expect(env.API_PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_CORS_ORIGINS).toEqual(['http://localhost:3001']);
    expect(env.API_SWAGGER_ENABLED).toBe(true);
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
      expect(message).not.toContain('secret-password');
    }
  });
});
