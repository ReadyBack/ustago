/**
 * Fail-closed rules for staging and production (docs/adr/0022). The API
 * refuses to boot when any rule is broken, and the message names the
 * variable, never its value.
 *
 * Staging and production share every rule that keeps test money, demo
 * data, development adapters and placeholder secrets out. Production adds
 * a few that staging may relax (Swagger, metrics token, deletion grace).
 */
export type AppEnv = 'development' | 'test' | 'staging' | 'production';

/** The fields the rules read (the parsed env before defaults are resolved). */
export interface SafetyInput {
  NODE_ENV: 'development' | 'test' | 'production';
  APP_ENV?: AppEnv | undefined;
  JWT_ACCESS_SECRET: string;
  OTP_HASH_SECRET?: string | undefined;
  STORAGE_SIGNING_SECRET?: string | undefined;
  IP_HASH_SECRET?: string | undefined;
  SMS_PROVIDER: string;
  PUSH_PROVIDER: string;
  STORAGE_DRIVER: string;
  PAYMENT_PROVIDER: string;
  PAYOUT_PROVIDER: string;
  FINANCE_EARNING_HOLD_HOURS?: number | undefined;
  FINANCE_MIN_PAYOUT_MINOR?: number | undefined;
  API_CORS_ORIGINS: string[];
  API_SWAGGER_ENABLED: boolean;
  ALLOW_DEV_PAYMENT_SIMULATION?: boolean | undefined;
  ALLOW_TEST_KYC?: boolean | undefined;
  DEMO_SEED?: boolean | undefined;
  RECONCILIATION_INTERVAL_MINUTES: number;
  LOG_FORMAT?: 'pretty' | 'json' | undefined;
  METRICS_ENABLED: boolean;
  METRICS_TOKEN?: string | undefined;
  ACCOUNT_DELETION_GRACE_HOURS?: number | undefined;
}

export interface SafetyIssue {
  key: string;
  message: string;
}

/** Placeholder used in .env.example; never acceptable outside development. */
export const EXAMPLE_SECRET_MARKER = 'change-me';

export function resolveAppEnv(env: Pick<SafetyInput, 'NODE_ENV' | 'APP_ENV'>): AppEnv {
  if (env.APP_ENV) return env.APP_ENV;
  return env.NODE_ENV === 'production'
    ? 'production'
    : env.NODE_ENV === 'test'
      ? 'test'
      : 'development';
}

/** staging or production: every development shortcut is refused. */
export function isStrictEnv(appEnv: AppEnv): boolean {
  return appEnv === 'staging' || appEnv === 'production';
}

export function productionSafetyIssues(env: SafetyInput): SafetyIssue[] {
  const appEnv = resolveAppEnv(env);
  if (!isStrictEnv(appEnv)) return [];
  const issues: SafetyIssue[] = [];
  const add = (key: string, message: string) => issues.push({ key, message });

  if (env.JWT_ACCESS_SECRET.includes(EXAMPLE_SECRET_MARKER)) {
    add('JWT_ACCESS_SECRET', `uses the example placeholder; set a real secret in ${appEnv}`);
  }
  for (const key of ['OTP_HASH_SECRET', 'STORAGE_SIGNING_SECRET', 'IP_HASH_SECRET'] as const) {
    const value = env[key];
    if (!value || value.includes(EXAMPLE_SECRET_MARKER)) {
      add(key, `must be set to a real secret in ${appEnv}`);
    }
  }
  // Development adapters (codes in logs, files on local disk, test money).
  if (env.SMS_PROVIDER === 'console' || env.SMS_PROVIDER === 'fake') {
    add('SMS_PROVIDER', `console/fake SMS providers are not allowed in ${appEnv}`);
  }
  if (env.PUSH_PROVIDER === 'console') {
    add('PUSH_PROVIDER', `the console push provider is not allowed in ${appEnv}`);
  }
  if (env.STORAGE_DRIVER === 'local') {
    add('STORAGE_DRIVER', `the local storage driver is not allowed in ${appEnv}`);
  }
  if (env.PAYMENT_PROVIDER === 'mock') {
    add('PAYMENT_PROVIDER', `the mock payment provider is not allowed in ${appEnv}`);
  }
  if (env.PAYOUT_PROVIDER === 'mock') {
    add('PAYOUT_PROVIDER', `the mock payout provider is not allowed in ${appEnv}`);
  }
  // Explicit "true" is refused; unset resolves to false outside development.
  for (const key of ['ALLOW_DEV_PAYMENT_SIMULATION', 'ALLOW_TEST_KYC', 'DEMO_SEED'] as const) {
    if (env[key] === true) add(key, `must not be enabled in ${appEnv}`);
  }
  if (env.FINANCE_EARNING_HOLD_HOURS === undefined) {
    add('FINANCE_EARNING_HOLD_HOURS', `must be set explicitly in ${appEnv} (a business decision)`);
  }
  if (env.FINANCE_MIN_PAYOUT_MINOR === undefined) {
    add('FINANCE_MIN_PAYOUT_MINOR', `must be set explicitly in ${appEnv} (a business decision)`);
  }
  if (env.API_CORS_ORIGINS.length === 0 || env.API_CORS_ORIGINS.includes('*')) {
    add('API_CORS_ORIGINS', `must list explicit origins in ${appEnv}`);
  }
  if (env.RECONCILIATION_INTERVAL_MINUTES === 0) {
    add('RECONCILIATION_INTERVAL_MINUTES', `finance reconciliation must be scheduled in ${appEnv}`);
  }
  if (env.LOG_FORMAT === 'pretty') {
    add('LOG_FORMAT', `structured (json) logs are required in ${appEnv}`);
  }

  if (appEnv === 'production') {
    if (env.API_SWAGGER_ENABLED) {
      add('API_SWAGGER_ENABLED', 'the API explorer is not served in production');
    }
    if (env.METRICS_ENABLED && !env.METRICS_TOKEN) {
      add('METRICS_TOKEN', 'metrics need a bearer token in production');
    }
    if (env.ACCOUNT_DELETION_GRACE_HOURS === undefined) {
      add(
        'ACCOUNT_DELETION_GRACE_HOURS',
        'must be set explicitly in production (a legal/business decision)',
      );
    }
  }
  return issues;
}

export interface SecuritySummaryInput {
  APP_ENV: AppEnv;
  PAYMENT_PROVIDER: string;
  PAYOUT_PROVIDER: string;
  PAYMENTS_ENABLED: boolean;
  PAYOUTS_ENABLED: boolean;
  SMS_PROVIDER: string;
  PUSH_PROVIDER: string;
  STORAGE_DRIVER: string;
  KYC_PROVIDER: string;
  MALWARE_SCANNER: string;
  DEMO_SEED: boolean;
  ALLOW_DEV_PAYMENT_SIMULATION: boolean;
  ALLOW_TEST_KYC: boolean;
  API_SWAGGER_ENABLED: boolean;
  RECONCILIATION_INTERVAL_MINUTES: number;
  ERROR_REPORTER: string;
  LOG_FORMAT: string;
}

/**
 * A secret-free, one-screen summary of what this process will do, logged
 * at startup ("Payment provider: disabled", "Dev routes: disabled").
 */
export function securitySummary(env: SecuritySummaryInput): string[] {
  const onOff = (value: boolean) => (value ? 'enabled' : 'disabled');
  const provider = (name: string, enabled: boolean) =>
    enabled && name !== 'disabled' ? name : 'disabled';
  return [
    `Environment: ${env.APP_ENV}`,
    `Payment provider: ${provider(env.PAYMENT_PROVIDER, env.PAYMENTS_ENABLED)}`,
    `Payout provider: ${provider(env.PAYOUT_PROVIDER, env.PAYOUTS_ENABLED)}`,
    `SMS provider: ${env.SMS_PROVIDER}`,
    `Push provider: ${env.PUSH_PROVIDER}`,
    `Object storage: ${env.STORAGE_DRIVER}`,
    `KYC provider: ${env.KYC_PROVIDER} (no automated identity verification)`,
    `Malware scanner: ${env.MALWARE_SCANNER === 'none' ? 'none (documents stay NOT_SCANNED)' : env.MALWARE_SCANNER}`,
    `Demo data: ${onOff(env.DEMO_SEED)}`,
    `Dev routes: ${onOff(env.ALLOW_DEV_PAYMENT_SIMULATION)}`,
    `Test KYC decisions in seed: ${onOff(env.ALLOW_TEST_KYC)}`,
    `API explorer: ${onOff(env.API_SWAGGER_ENABLED)}`,
    `Reconciliation schedule: ${
      env.RECONCILIATION_INTERVAL_MINUTES === 0
        ? 'manual only'
        : `every ${env.RECONCILIATION_INTERVAL_MINUTES} min`
    }`,
    `Error reporter: ${env.ERROR_REPORTER}`,
    `Log format: ${env.LOG_FORMAT}`,
  ];
}
