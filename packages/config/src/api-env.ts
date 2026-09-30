import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

/** Placeholder used in .env.example; never acceptable in production. */
const EXAMPLE_SECRET_MARKER = 'change-me';

export const apiEnvSchema = z
  .object({
    APP_VERSION: z.string().min(1).default('0.0.0-dev'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
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
    if (env.AUTH_SESSION_MAX_DAYS < env.AUTH_REFRESH_TTL_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_SESSION_MAX_DAYS'],
        message: 'must be greater than or equal to AUTH_REFRESH_TTL_DAYS',
      });
    }
    if (env.NODE_ENV !== 'production') return;
    if (env.JWT_ACCESS_SECRET.includes(EXAMPLE_SECRET_MARKER)) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_ACCESS_SECRET'],
        message: 'uses the example placeholder; set a real secret in production',
      });
    }
    for (const key of ['OTP_HASH_SECRET', 'STORAGE_SIGNING_SECRET'] as const) {
      const value = env[key];
      if (!value || value.includes(EXAMPLE_SECRET_MARKER)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'must be set to a real secret in production',
        });
      }
    }
    // Development adapters must never run in production (codes in logs,
    // files on local disk).
    if (env.SMS_PROVIDER === 'console' || env.SMS_PROVIDER === 'fake') {
      ctx.addIssue({
        code: 'custom',
        path: ['SMS_PROVIDER'],
        message: 'console/fake SMS providers are not allowed in production',
      });
    }
    if (env.PUSH_PROVIDER === 'console') {
      ctx.addIssue({
        code: 'custom',
        path: ['PUSH_PROVIDER'],
        message: 'the console push provider is not allowed in production',
      });
    }
    if (env.STORAGE_DRIVER === 'local') {
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_DRIVER'],
        message: 'the local storage driver is not allowed in production',
      });
    }
    if (env.API_CORS_ORIGINS.includes('*')) {
      ctx.addIssue({
        code: 'custom',
        path: ['API_CORS_ORIGINS'],
        message: 'must list explicit origins in production',
      });
    }
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;
