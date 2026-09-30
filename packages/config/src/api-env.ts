import { z } from 'zod';

import { productionSafetyIssues, resolveAppEnv } from './production-safety.js';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

/**
 * Application environment (docs/adr/0022). NODE_ENV only says how the code
 * was built; APP_ENV says where it runs, so staging can run a production
 * build with its own rules. Unset, it follows NODE_ENV.
 */
export const APP_ENVIRONMENTS = ['development', 'test', 'staging', 'production'] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

/** "10,20,50" → [10, 20, 50]; every item an integer within [min, max]. */
function intList(fallback: string, min: number, max: number) {
  return z
    .string()
    .default(fallback)
    .transform((v, ctx) => {
      const items = v.split(',').map((x) => Number(x.trim()));
      if (items.length === 0 || items.some((n) => !Number.isInteger(n) || n < min || n > max)) {
        ctx.addIssue({ code: 'custom', message: `must be integers between ${min} and ${max}` });
        return z.NEVER;
      }
      return items;
    });
}

export const apiEnvSchema = z
  .object({
    APP_VERSION: z.string().min(1).default('0.0.0-dev'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: z.enum(APP_ENVIRONMENTS).optional(),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    API_CORS_ORIGINS: z
      .string()
      .default('http://localhost:3001')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    API_SWAGGER_ENABLED: booleanString.default(true),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'log', 'debug', 'verbose']).default('log'),

    // --- Auth (docs/adr/0007-auth-ve-token-stratejisi.md) ---
    /** HS256 signing key for access tokens. At least 32 characters. */
    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    JWT_ISSUER: z.string().min(1).default('ustago-api'),
    JWT_AUDIENCE: z.string().min(1).default('ustago-clients'),
    /** Lifetime of one refresh token; each refresh issues a new one. */
    AUTH_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    /** Absolute session lifetime; rotation never extends past it. */
    AUTH_SESSION_MAX_DAYS: z.coerce.number().int().min(1).max(365).default(90),
    /** Requests per window per IP (and per e-mail for login) on auth endpoints. */
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
    AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).default(60),

    // --- Phone OTP (docs/adr/0009-otp-ve-sms-saglayici.md) ---
    /** How long a code stays valid. */
    OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(180),
    /** Wrong guesses allowed per code before it is locked. */
    OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
    OTP_CODE_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
    /** Codes sent to one phone number per window (resends included). */
    OTP_REQUEST_WINDOW_SECONDS: z.coerce.number().int().min(60).default(3600),
    OTP_MAX_REQUESTS_PER_WINDOW: z.coerce.number().int().min(1).default(5),
    /** Minimum wait between two codes to the same number. */
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(0).max(600).default(60),
    /**
     * HMAC key for stored code hashes. Optional outside production, where a
     * key derived from JWT_ACCESS_SECRET is used; required in production.
     */
    OTP_HASH_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
    /**
     * console: writes codes to the API log (development only).
     * fake: keeps codes in memory for automated tests.
     * disabled: OTP endpoints answer 503; the only choice in production
     * until a real SMS adapter (Netgsm, İleti Merkezi, Twilio...) is added.
     */
    SMS_PROVIDER: z.enum(['console', 'fake', 'disabled']).default('console'),

    // --- Push (docs/adr/0017-bildirim-outbox-ve-expo-push.md) ---
    /**
     * console: logs "[DEV PUSH]" lines and records the attempt as a
     * development ticket; nothing is sent (development only).
     * expo: sends through the Expo Push API (needs a real device token).
     * disabled: push rows are skipped; in-app notifications still work.
     */
    PUSH_PROVIDER: z.enum(['console', 'expo', 'disabled']).default('console'),
    /** Optional Expo access token (only when "Enhanced push security" is on). */
    EXPO_ACCESS_TOKEN: z.string().min(1).optional(),
    /** Seconds between push worker runs; 0 turns the worker off (tests). */
    PUSH_WORKER_INTERVAL_SECONDS: z.coerce.number().int().min(0).max(3600).default(5),
    /** Attempts before a push delivery is marked FAILED (exponential backoff between). */
    PUSH_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
    /** Expo keeps receipts ~24h and recommends checking after ~15 minutes. */
    PUSH_RECEIPT_DELAY_SECONDS: z.coerce.number().int().min(0).max(86400).default(900),

    // --- Object storage (docs/adr/0011-dogrulama-belgeleri-ve-nesne-depolama.md) ---
    /**
     * local: files on disk behind short-lived signed URLs served by the API
     * (development and tests). disabled: uploads answer 503. An S3-compatible
     * driver is added before production.
     */
    STORAGE_DRIVER: z.enum(['local', 'disabled']).default('local'),
    /** Directory for the local driver, relative to the API's working directory. */
    STORAGE_LOCAL_DIR: z.string().min(1).default('.data/storage'),
    /** Base URL clients use to reach this API, for local signed URLs. */
    STORAGE_PUBLIC_BASE_URL: z.url().default('http://localhost:3000'),
    /** Signs local storage URLs. Optional outside production (derived from JWT_ACCESS_SECRET). */
    STORAGE_SIGNING_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
    /** Upper bound for one verification document. */
    VERIFICATION_MAX_FILE_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(50 * 1024 * 1024)
      .default(10 * 1024 * 1024),
    /** Lifetime of a signed upload URL. */
    UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    /** Lifetime of a signed URL an admin uses to view a document. */
    DOCUMENT_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(900).default(120),

    // --- Service requests (docs/adr/0014-talep-teklif-ve-now.md) ---
    /** How long a "Teklif Al" request stays open for quotes. */
    QUOTE_REQUEST_TTL_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 60)
      .default(24 * 14),
    /** How long a NOW request keeps looking for a provider. */
    NOW_REQUEST_TTL_MINUTES: z.coerce
      .number()
      .int()
      .min(5)
      .max(24 * 60)
      .default(60),
    /** Providers notified per NOW request (one dispatch wave). */
    NOW_DISPATCH_WAVE_SIZE: z.coerce.number().int().min(1).max(200).default(20),
    /** Seconds between sweeps that expire old requests; 0 turns the sweep off (tests). */
    REQUEST_EXPIRY_SWEEP_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),
    /** Upper bound for one request photo. */
    REQUEST_PHOTO_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(20 * 1024 * 1024)
      .default(10 * 1024 * 1024),
    // --- Finance (docs/adr/0018-0020) ---
    /**
     * mock: MockPaymentProvider, test payments only, no money moves
     * (development and tests; refused in production).
     * disabled: online payments answer 503. A real adapter (iyzico, PayTR...)
     * is added only after its official docs and merchant terms are verified.
     */
    PAYMENT_PROVIDER: z.enum(['mock', 'disabled']).default('mock'),
    /** mock: test payouts that an admin marks paid/failed by hand; refused in production. */
    PAYOUT_PROVIDER: z.enum(['mock', 'disabled']).default('mock'),
    /** Feature flags: "Uygulamadan öde", "Ustaya doğrudan öde", "Para Çek". */
    PAYMENTS_ENABLED: booleanString.default(true),
    CASH_ENABLED: booleanString.default(true),
    PAYOUTS_ENABLED: booleanString.default(true),
    /**
     * HMAC key the mock provider signs its webhooks with. Optional outside
     * production (derived from JWT_ACCESS_SECRET).
     */
    MOCK_PAYMENT_WEBHOOK_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
    /** Webhooks older than this (by their signed timestamp) are refused as replays. */
    PAYMENT_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
    /**
     * Hours an online earning stays pending after the job is completed
     * before it becomes available (dispute window). Development uses 0; the
     * production value is a business decision and has no default here.
     */
    FINANCE_EARNING_HOLD_HOURS: z.coerce
      .number()
      .int()
      .min(0)
      .max(24 * 90)
      .optional(),
    /** When a cash job is confirmed, book the platform fee as provider debt. */
    FINANCE_CASH_COMMISSION_ENABLED: booleanString.default(true),
    /** New online earnings first pay off the provider's platform debt. */
    FINANCE_DEBT_OFFSET_ENABLED: booleanString.default(true),
    /** Smallest payout a provider can request (kuruş). No production default. */
    FINANCE_MIN_PAYOUT_MINOR: z.coerce.number().int().min(1).optional(),
    /** Payment attempts before a payment is marked FAILED. */
    FINANCE_MAX_PAYMENT_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
    /** Seconds between earning-release / refund-retry sweeps; 0 turns it off (tests). */
    FINANCE_SWEEP_SECONDS: z.coerce.number().int().min(0).max(3600).default(15),

    // --- Faz 6: production safety switches (docs/adr/0022) ---
    /**
     * Development conveniences that must never exist in staging or
     * production. Unset, they are on in development/test and off elsewhere;
     * setting any of them to true in staging/production refuses to boot.
     */
    /** /dev/payments/* simulate and /admin/dev/payouts/* mark-paid/failed. */
    ALLOW_DEV_PAYMENT_SIMULATION: booleanString.optional(),
    /** The seed may write DEMO verification decisions (no real review happened). */
    ALLOW_TEST_KYC: booleanString.optional(),
    /** The seed may write DEMO accounts, jobs and TEST money. */
    DEMO_SEED: booleanString.optional(),
    /**
     * manual: admins review documents by hand (the only option: no KYC
     * provider has been chosen, docs/decisions/kyc-provider-selection.md).
     * disabled: verification uploads answer 503.
     */
    KYC_PROVIDER: z.enum(['manual', 'disabled']).default('manual'),
    /**
     * none: no antivirus is connected; documents stay NOT_SCANNED (never
     * reported as clean). A real scanner adapter is a release blocker.
     */
    MALWARE_SCANNER: z.enum(['none']).default('none'),
    /** Keyed hash for IP addresses in sessions and risk signals. */
    IP_HASH_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
    /** Staff sessions: absolute lifetime and inactivity limit. */
    ADMIN_SESSION_MAX_HOURS: z.coerce.number().int().min(1).max(72).default(12),
    ADMIN_IDLE_TIMEOUT_MINUTES: z.coerce
      .number()
      .int()
      .min(5)
      .max(24 * 60)
      .default(60),
    /** New quotes one provider may send (anti-spam, generous for real work). */
    QUOTE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(10),
    QUOTE_RATE_LIMIT_PER_HOUR: z.coerce.number().int().min(1).max(10000).default(120),
    /** Kill switch for creating new service requests (env ceiling). */
    NEW_JOBS_ENABLED: booleanString.default(true),
    /**
     * Minutes between scheduled finance reconciliations; 0 = manual only
     * (development default). Staging/production must schedule it.
     */
    RECONCILIATION_INTERVAL_MINUTES: z.coerce
      .number()
      .int()
      .min(0)
      .max(7 * 24 * 60)
      .default(0),
    /** Seconds between operations sweeps (suspension expiry, alert checks); 0 = off. */
    OPS_WORKER_INTERVAL_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),
    /** Push deliveries FAILED in the last hour that raise PUSH_FAILURE_SPIKE. */
    PUSH_FAILURE_ALERT_THRESHOLD: z.coerce.number().int().min(1).default(20),
    /** A pending push older than this raises QUEUE_BACKLOG. */
    QUEUE_BACKLOG_ALERT_MINUTES: z.coerce.number().int().min(1).default(15),
    /** Prometheus text metrics at /api/v1/metrics (needs METRICS_TOKEN outside dev). */
    METRICS_ENABLED: booleanString.default(true),
    METRICS_TOKEN: z.string().min(32, 'must be at least 32 characters').optional(),
    /** pretty: Nest's console format (development). json: one JSON object per line. */
    LOG_FORMAT: z.enum(['pretty', 'json']).optional(),
    /** console: errors to the log only (no external provider such as Sentry is connected). */
    ERROR_REPORTER: z.enum(['console', 'none']).default('console'),
    /**
     * Hours between an account deletion request and anonymisation. A
     * legal/business decision: no production default.
     */
    ACCOUNT_DELETION_GRACE_HOURS: z.coerce
      .number()
      .int()
      .min(0)
      .max(24 * 90)
      .optional(),

    // --- Faz 7 marketplace (docs/adr/0028-0031) ---
    /**
     * Providers per dispatch wave, comma separated ("10,20,50"): wave 1 goes
     * to the best nearby matches, later waves widen. Never nationwide.
     */
    DISPATCH_WAVE_SIZES: intList('10,20,50', 1, 200),
    /**
     * Extra distance cap (km) per wave, same order; 0 = only the provider's
     * own service areas limit it.
     */
    DISPATCH_WAVE_RADII_KM: intList('15,40,0', 0, 500),
    /** Minutes before the next wave when the request has too few quotes. */
    DISPATCH_WAVE_INTERVAL_MINUTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 60)
      .default(30),
    /** A request with this many quotes stops widening. */
    DISPATCH_TARGET_QUOTES: z.coerce.number().int().min(1).max(20).default(3),
    /** Seconds between dispatch sweeps; 0 turns the sweep off (tests). */
    DISPATCH_SWEEP_SECONDS: z.coerce.number().int().min(0).max(3600).default(30),
    /** Minutes without a quote before the customer sees "henüz teklif gelmedi". */
    NO_OFFER_ALERT_MINUTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 60 * 7)
      .default(120),
    /** Days after approval during which a new provider gets the cold-start boost. */
    MATCH_COLD_START_DAYS: z.coerce.number().int().min(0).max(365).default(60),
    /** Completed jobs (and distinct providers) needed before a price guide is shown. */
    PRICE_GUIDE_MIN_SAMPLE: z.coerce.number().int().min(3).max(1000).default(10),
    PRICE_GUIDE_MIN_PROVIDERS: z.coerce.number().int().min(2).max(100).default(3),
    /** Dispatches needed before a provider's response time is shown. */
    RESPONSE_STATS_MIN_SAMPLE: z.coerce.number().int().min(1).max(1000).default(5),
    /** Requests in 30 days before a category is listed as "popular". */
    POPULAR_CATEGORY_MIN_REQUESTS: z.coerce.number().int().min(1).max(10000).default(3),
    /** Chat messages per user and conversation per minute, and per user per hour. */
    CHAT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(600).default(20),
    CHAT_RATE_LIMIT_PER_HOUR: z.coerce.number().int().min(1).max(10000).default(300),
    /** Upper bound for chat, portfolio and profile photos. */
    MEDIA_IMAGE_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(20 * 1024 * 1024)
      .default(8 * 1024 * 1024),
    /** Searches per user (or IP) per minute. */
    SEARCH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(60),

    /** IANA zone for business "today" in admin statistics (data stays UTC). */
    MARKETPLACE_TIME_ZONE: z
      .string()
      .default('Europe/Istanbul')
      .refine((tz) => {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, 'must be an IANA time zone'),
  })
  .superRefine((env, ctx) => {
    if (env.DISPATCH_WAVE_SIZES.length !== env.DISPATCH_WAVE_RADII_KM.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['DISPATCH_WAVE_RADII_KM'],
        message: 'needs one value per DISPATCH_WAVE_SIZES item',
      });
    }
    if (env.AUTH_SESSION_MAX_DAYS < env.AUTH_REFRESH_TTL_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_SESSION_MAX_DAYS'],
        message: 'must be greater than or equal to AUTH_REFRESH_TTL_DAYS',
      });
    }
    if (
      (env.APP_ENV === 'staging' || env.APP_ENV === 'production') &&
      env.NODE_ENV !== 'production'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_ENV'],
        message: 'staging and production need a production build (NODE_ENV=production)',
      });
    }
    for (const issue of productionSafetyIssues(env)) {
      ctx.addIssue({ code: 'custom', path: [issue.key], message: issue.message });
    }
  })
  .transform((env) => {
    const appEnv = resolveAppEnv(env);
    const devLike = appEnv === 'development' || appEnv === 'test';
    return {
      ...env,
      APP_ENV: appEnv,
      ALLOW_DEV_PAYMENT_SIMULATION: env.ALLOW_DEV_PAYMENT_SIMULATION ?? devLike,
      ALLOW_TEST_KYC: env.ALLOW_TEST_KYC ?? devLike,
      DEMO_SEED: env.DEMO_SEED ?? devLike,
      LOG_FORMAT: env.LOG_FORMAT ?? (devLike ? ('pretty' as const) : ('json' as const)),
    };
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;
