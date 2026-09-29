import 'server-only';

import { z } from 'zod';

const serverEnvSchema = z.object({
  ADMIN_API_URL: z.url().default('http://localhost:3000'),
});

export const serverEnv = serverEnvSchema.parse({
  ADMIN_API_URL: process.env.ADMIN_API_URL,
});
