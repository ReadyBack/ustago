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

  it('treats empty values from a copied .env.example as unset', () => {
    const env = parseEnv(apiEnvSchema, {
      ...validEnv,
      OTP_HASH_SECRET: '',
      STORAGE_SIGNING_SECRET: '',
      API_PORT: '',
    });
    expect(env.OTP_HASH_SECRET).toBeUndefined();
    expect(env.STORAGE_SIGNING_SECRET).toBeUndefined();
    expect(env.API_PORT).toBe(3000);
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

  it('applies OTP and storage defaults', () => {
    const env = parseEnv(apiEnvSchema, validEnv);
    expect(env.OTP_TTL_SECONDS).toBe(180);
    expect(env.OTP_MAX_ATTEMPTS).toBe(5);
    expect(env.OTP_CODE_LENGTH).toBe(6);
    expect(env.SMS_PROVIDER).toBe('console');
    expect(env.STORAGE_DRIVER).toBe('local');
    expect(env.VERIFICATION_MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
  });

  it('never allows development SMS or storage adapters in production', () => {
    const result = apiEnvSchema.safeParse({
      ...validEnv,
      NODE_ENV: 'production',
      API_CORS_ORIGINS: 'https://admin.ustago.example',
      SMS_PROVIDER: 'console',
      STORAGE_DRIVER: 'local',
      PUSH_PROVIDER: 'console',
    });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((issue) => issue.path.join('.'));
    expect(paths).toEqual(
      expect.arrayContaining([
        'SMS_PROVIDER',
        'PUSH_PROVIDER',
        'STORAGE_DRIVER',
        'OTP_HASH_SECRET',
        'STORAGE_SIGNING_SECRET',
      ]),
    );
  });

  it('boots in production with adapters disabled and real secrets', () => {
    const result = apiEnvSchema.safeParse({
      ...validEnv,
      NODE_ENV: 'production',
      API_CORS_ORIGINS: 'https://admin.ustago.example',
      SMS_PROVIDER: 'disabled',
      STORAGE_DRIVER: 'disabled',
      PUSH_PROVIDER: 'expo',
      OTP_HASH_SECRET: 'x'.repeat(40),
      STORAGE_SIGNING_SECRET: 'y'.repeat(40),
      PAYMENT_PROVIDER: 'disabled',
      PAYOUT_PROVIDER: 'disabled',
      FINANCE_EARNING_HOLD_HOURS: '72',
      FINANCE_MIN_PAYOUT_MINOR: '10000',
      // Faz 6 production requirements (docs/adr/0022).
      IP_HASH_SECRET: 'z'.repeat(40),
      API_SWAGGER_ENABLED: 'false',
      RECONCILIATION_INTERVAL_MINUTES: '1440',
      METRICS_TOKEN: 'm'.repeat(40),
      ACCOUNT_DELETION_GRACE_HOURS: '720',
    });
    expect(result.success).toBe(true);
    expect(result.data?.APP_ENV).toBe('production');
    expect(result.data?.DEMO_SEED).toBe(false);
    expect(result.data?.ALLOW_DEV_PAYMENT_SIMULATION).toBe(false);
    expect(result.data?.LOG_FORMAT).toBe('json');
  });

  it('applies finance defaults (test money, no production values)', () => {
    const env = parseEnv(apiEnvSchema, validEnv);
    expect(env.PAYMENT_PROVIDER).toBe('mock');
    expect(env.PAYOUT_PROVIDER).toBe('mock');
    expect(env.PAYMENTS_ENABLED).toBe(true);
    expect(env.CASH_ENABLED).toBe(true);
    expect(env.PAYOUTS_ENABLED).toBe(true);
    expect(env.FINANCE_CASH_COMMISSION_ENABLED).toBe(true);
    expect(env.FINANCE_EARNING_HOLD_HOURS).toBeUndefined();
    expect(env.FINANCE_MIN_PAYOUT_MINOR).toBeUndefined();
  });

  it('refuses to boot production with the mock payment or payout provider', () => {
    const result = apiEnvSchema.safeParse({
      ...validEnv,
      NODE_ENV: 'production',
      API_CORS_ORIGINS: 'https://admin.ustago.example',
      SMS_PROVIDER: 'disabled',
      STORAGE_DRIVER: 'disabled',
      PUSH_PROVIDER: 'expo',
      OTP_HASH_SECRET: 'x'.repeat(40),
      STORAGE_SIGNING_SECRET: 'y'.repeat(40),
      PAYMENT_PROVIDER: 'mock',
      PAYOUT_PROVIDER: 'mock',
    });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((issue) => issue.path.join('.'));
    expect(paths).toEqual(
      expect.arrayContaining([
        'PAYMENT_PROVIDER',
        'PAYOUT_PROVIDER',
        'FINANCE_EARNING_HOLD_HOURS',
        'FINANCE_MIN_PAYOUT_MINOR',
      ]),
    );
  });
});
