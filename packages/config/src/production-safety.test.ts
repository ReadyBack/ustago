import { describe, expect, it } from 'vitest';

import { apiEnvSchema } from './api-env.js';
import { productionSafetyIssues, resolveAppEnv, securitySummary } from './production-safety.js';

const base = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'test-only-secret-that-is-long-enough-123',
};

/** A staging/production env that satisfies every rule. */
const strict = {
  ...base,
  NODE_ENV: 'production',
  API_CORS_ORIGINS: 'https://admin.ustago.example',
  SMS_PROVIDER: 'disabled',
  STORAGE_DRIVER: 'disabled',
  PUSH_PROVIDER: 'disabled',
  PAYMENT_PROVIDER: 'disabled',
  PAYOUT_PROVIDER: 'disabled',
  OTP_HASH_SECRET: 'o'.repeat(40),
  STORAGE_SIGNING_SECRET: 's'.repeat(40),
  IP_HASH_SECRET: 'i'.repeat(40),
  FINANCE_EARNING_HOLD_HOURS: '72',
  FINANCE_MIN_PAYOUT_MINOR: '10000',
  RECONCILIATION_INTERVAL_MINUTES: '1440',
  API_SWAGGER_ENABLED: 'false',
  METRICS_TOKEN: 'm'.repeat(40),
  ACCOUNT_DELETION_GRACE_HOURS: '720',
};

const failingKeys = (env: Record<string, string>) => {
  const result = apiEnvSchema.safeParse(env);
  return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
};

describe('APP_ENV', () => {
  it('follows NODE_ENV when unset', () => {
    expect(resolveAppEnv({ NODE_ENV: 'production' })).toBe('production');
    expect(resolveAppEnv({ NODE_ENV: 'test' })).toBe('test');
    expect(resolveAppEnv({ NODE_ENV: 'development' })).toBe('development');
    expect(resolveAppEnv({ NODE_ENV: 'production', APP_ENV: 'staging' })).toBe('staging');
  });

  it('turns development conveniences on only in development and test', () => {
    const dev = apiEnvSchema.parse(base);
    expect(dev.APP_ENV).toBe('development');
    expect(dev.ALLOW_DEV_PAYMENT_SIMULATION).toBe(true);
    expect(dev.DEMO_SEED).toBe(true);
    expect(dev.ALLOW_TEST_KYC).toBe(true);
    expect(dev.LOG_FORMAT).toBe('pretty');
    const staging = apiEnvSchema.parse({ ...strict, APP_ENV: 'staging' });
    expect(staging.ALLOW_DEV_PAYMENT_SIMULATION).toBe(false);
    expect(staging.DEMO_SEED).toBe(false);
    expect(staging.ALLOW_TEST_KYC).toBe(false);
    expect(staging.LOG_FORMAT).toBe('json');
  });

  it('needs a production build for staging and production', () => {
    expect(failingKeys({ ...strict, NODE_ENV: 'development', APP_ENV: 'production' })).toContain(
      'APP_ENV',
    );
  });
});

describe('production config validator (fail closed)', () => {
  it('accepts a complete production config', () => {
    expect(failingKeys(strict)).toEqual([]);
  });

  it.each([
    ['PAYMENT_PROVIDER', 'mock'],
    ['PAYOUT_PROVIDER', 'mock'],
    ['ALLOW_TEST_KYC', 'true'],
    ['ALLOW_DEV_PAYMENT_SIMULATION', 'true'],
    ['DEMO_SEED', 'true'],
    ['SMS_PROVIDER', 'console'],
    ['SMS_PROVIDER', 'fake'],
    ['PUSH_PROVIDER', 'console'],
    ['STORAGE_DRIVER', 'local'],
    ['API_CORS_ORIGINS', '*'],
    ['API_CORS_ORIGINS', 'http://localhost:3001'],
    ['API_CORS_ORIGINS', 'https://admin.ustago.example,https://localhost'],
    ['API_CORS_ORIGINS', 'http://admin.ustago.example'],
    ['RECONCILIATION_INTERVAL_MINUTES', '0'],
    ['LOG_FORMAT', 'pretty'],
    ['API_SWAGGER_ENABLED', 'true'],
  ])('refuses %s=%s in production', (key, value) => {
    expect(failingKeys({ ...strict, [key]: value })).toContain(key);
  });

  it.each(['OTP_HASH_SECRET', 'STORAGE_SIGNING_SECRET', 'IP_HASH_SECRET', 'METRICS_TOKEN'])(
    'refuses production without %s',
    (key) => {
      const env = Object.fromEntries(Object.entries(strict).filter(([k]) => k !== key));
      expect(failingKeys(env)).toContain(key);
    },
  );

  it('staging shares the money and demo rules but may keep the API explorer', () => {
    const staging = { ...strict, APP_ENV: 'staging', API_SWAGGER_ENABLED: 'true' };
    expect(failingKeys(staging)).toEqual([]);
    expect(failingKeys({ ...staging, PAYMENT_PROVIDER: 'mock' })).toContain('PAYMENT_PROVIDER');
    expect(failingKeys({ ...staging, DEMO_SEED: 'true' })).toContain('DEMO_SEED');
    const { ACCOUNT_DELETION_GRACE_HOURS: _grace, ...noDeletionGrace } = staging;
    expect(failingKeys(noDeletionGrace)).toEqual([]);
  });

  it('never echoes a value in its messages', () => {
    const issues = productionSafetyIssues({
      ...apiEnvSchema.parse(base),
      NODE_ENV: 'production',
      APP_ENV: 'production',
      JWT_ACCESS_SECRET: 'change-me-super-secret-value-1234567890',
    });
    const text = issues.map((i) => i.message).join(' ');
    expect(text).not.toContain('super-secret-value');
    expect(issues.map((i) => i.key)).toContain('JWT_ACCESS_SECRET');
  });

  it('has no rules in development', () => {
    expect(productionSafetyIssues(apiEnvSchema.parse(base))).toEqual([]);
  });
});

describe('securitySummary', () => {
  it('describes the process without secrets', () => {
    const env = apiEnvSchema.parse({ ...strict, APP_ENV: 'staging' });
    const lines = securitySummary(env);
    expect(lines).toContain('Environment: staging');
    expect(lines).toContain('Payment provider: disabled');
    expect(lines).toContain('Payout provider: disabled');
    expect(lines).toContain('Demo data: disabled');
    expect(lines).toContain('Dev routes: disabled');
    expect(lines.join('\n')).not.toContain('o'.repeat(40));
  });

  it('reports a disabled flag as a disabled provider', () => {
    const env = apiEnvSchema.parse({ ...base, PAYMENTS_ENABLED: 'false' });
    expect(securitySummary(env)).toContain('Payment provider: disabled');
    expect(securitySummary(env)).toContain('Payout provider: mock');
  });
});
