import { apiEnvSchema, type ApiEnv, parseEnv } from '@ustago/config';

export const API_ENV = Symbol('API_ENV');

export type { ApiEnv };

export function loadApiEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  return parseEnv(apiEnvSchema, source);
}
