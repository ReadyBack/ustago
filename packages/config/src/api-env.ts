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
    if (env.API_CORS_ORIGINS.includes('*')) {
      ctx.addIssue({
        code: 'custom',
        path: ['API_CORS_ORIGINS'],
        message: 'must list explicit origins in production',
      });
    }
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;
