import { apiEnvSchema, parseEnv } from '@ustago/config';

import { financeConfigFrom } from './finance.config.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'unit-test-secret-that-is-long-enough-1',
};

describe('financeConfigFrom', () => {
  it('development: mock providers, test mode, dev routes, dev defaults', () => {
    const c = financeConfigFrom(parseEnv(apiEnvSchema, base));
    expect(c.testMode).toBe(true);
    expect(c.devRoutesEnabled).toBe(true);
    expect(c.earningHoldHours).toBe(0);
    expect(c.minPayoutMinor).toBe(10000n);
    expect(c.mockWebhookSecret.length).toBeGreaterThan(0);
  });

  it('disabled providers: no test mode, no dev routes', () => {
    const c = financeConfigFrom(
      parseEnv(apiEnvSchema, {
        ...base,
        PAYMENT_PROVIDER: 'disabled',
        PAYOUT_PROVIDER: 'disabled',
      }),
    );
    expect(c.testMode).toBe(false);
    expect(c.devRoutesEnabled).toBe(false);
  });

  it('refuses mock providers in production even if the schema were bypassed', () => {
    const env = {
      ...parseEnv(apiEnvSchema, base),
      NODE_ENV: 'production' as const,
      APP_ENV: 'production' as const,
    };
    expect(() => financeConfigFrom(env)).toThrow(/not allowed in production/);
  });
});
