import 'server-only';

import { z } from 'zod';

const serverEnvSchema = z.object({
  ADMIN_API_URL: z.url().default('http://localhost:3000'),
  /** Secure cookies need HTTPS; only local development may turn this off. */
  ADMIN_COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

const parsed = serverEnvSchema.parse({
  ADMIN_API_URL: process.env.ADMIN_API_URL,
  ADMIN_COOKIE_SECURE: process.env.ADMIN_COOKIE_SECURE,
  NODE_ENV: process.env.NODE_ENV,
});

export const serverEnv = {
  ADMIN_API_URL: parsed.ADMIN_API_URL.replace(/\/+$/, ''),
  cookieSecure: parsed.NODE_ENV === 'production' ? true : parsed.ADMIN_COOKIE_SECURE === 'true',
  isProduction: parsed.NODE_ENV === 'production',
};
