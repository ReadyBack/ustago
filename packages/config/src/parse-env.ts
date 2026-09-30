import type { z } from 'zod';

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment variables:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

/**
 * Validates an environment object against a schema and fails fast with a
 * readable list of every problem. Values are never echoed back, so secrets
 * do not leak into logs.
 *
 * Empty values count as unset, so a `KEY=` line copied from .env.example
 * falls back to the schema default instead of failing a length check.
 */
export function parseEnv<T extends z.ZodType>(
  schema: T,
  env: Record<string, string | undefined>,
): z.infer<T> {
  const present = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value !== ''),
  );
  const result = schema.safeParse(present);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}
