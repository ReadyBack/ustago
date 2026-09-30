import type { ApiEnv } from '../config/env.js';
import { secretFor } from '../common/crypto/secrets.js';

export const FINANCE_CONFIG = Symbol('FINANCE_CONFIG');

/**
 * Every finance knob in one place (docs/adr/0018-0020); controllers and
 * services never carry magic numbers. Development defaults apply only
 * outside production: production refuses to boot without its own hold
 * period and minimum payout (packages/config api-env.ts).
 */
export interface FinanceConfig {
  currency: 'TRY';
  paymentsEnabled: boolean;
  cashEnabled: boolean;
  payoutsEnabled: boolean;
  paymentProvider: 'mock' | 'disabled';
  payoutProvider: 'mock' | 'disabled';
  /** True when test (mock) money is in use: UIs show "TEST ÖDEME". */
  testMode: boolean;
  /** Dev-only endpoints (mock simulate / mark-paid) are mounted. */
  devRoutesEnabled: boolean;
  earningHoldHours: number;
  cashCommissionEnabled: boolean;
  debtOffsetEnabled: boolean;
  minPayoutMinor: bigint;
  maxPaymentAttempts: number;
  webhookToleranceSeconds: number;
  mockWebhookSecret: Buffer;
  sweepSeconds: number;
}

/** Development-only fallbacks; never used in production (boot fails first). */
const DEV_HOLD_HOURS = 0;
const DEV_MIN_PAYOUT_MINOR = 10_000n;

export function financeConfigFrom(env: ApiEnv): FinanceConfig {
  const production = env.NODE_ENV === 'production';
  const mock = env.PAYMENT_PROVIDER === 'mock' || env.PAYOUT_PROVIDER === 'mock';
  if (production && mock) {
    // Defence in depth: the env schema already refuses this.
    throw new Error('Mock payment/payout providers are not allowed in production.');
  }
  return {
    currency: 'TRY',
    paymentsEnabled: env.PAYMENTS_ENABLED,
    cashEnabled: env.CASH_ENABLED,
    payoutsEnabled: env.PAYOUTS_ENABLED,
    paymentProvider: env.PAYMENT_PROVIDER,
    payoutProvider: env.PAYOUT_PROVIDER,
    testMode: env.PAYMENT_PROVIDER === 'mock',
    devRoutesEnabled: !production && mock,
    earningHoldHours: env.FINANCE_EARNING_HOLD_HOURS ?? DEV_HOLD_HOURS,
    cashCommissionEnabled: env.FINANCE_CASH_COMMISSION_ENABLED,
    debtOffsetEnabled: env.FINANCE_DEBT_OFFSET_ENABLED,
    minPayoutMinor:
      env.FINANCE_MIN_PAYOUT_MINOR !== undefined
        ? BigInt(env.FINANCE_MIN_PAYOUT_MINOR)
        : DEV_MIN_PAYOUT_MINOR,
    maxPaymentAttempts: env.FINANCE_MAX_PAYMENT_ATTEMPTS,
    webhookToleranceSeconds: env.PAYMENT_WEBHOOK_TOLERANCE_SECONDS,
    mockWebhookSecret: production
      ? Buffer.alloc(0)
      : secretFor(env, 'payment-webhook', env.MOCK_PAYMENT_WEBHOOK_SECRET),
    sweepSeconds: env.FINANCE_SWEEP_SECONDS,
  };
}
