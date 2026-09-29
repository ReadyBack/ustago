import 'server-only';

import type { HealthResponse } from '@ustago/types';
import { healthResponseSchema } from '@ustago/validation';

import { serverEnv } from './env';

/** Returns the API health, or null when the API cannot be reached. */
export async function fetchApiHealth(): Promise<HealthResponse | null> {
  try {
    const res = await fetch(`${serverEnv.ADMIN_API_URL}/api/v1/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    const parsed = healthResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
