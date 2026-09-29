import { describe, expect, it } from 'vitest';

import { healthResponseSchema } from './health.js';

describe('healthResponseSchema', () => {
  it('accepts a healthy response', () => {
    const result = healthResponseSchema.safeParse({
      status: 'ok',
      version: '0.0.0',
      uptimeSeconds: 1,
      timestamp: new Date().toISOString(),
      checks: { database: { status: 'up', latencyMs: 2 }, redis: { status: 'up' } },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown status', () => {
    const result = healthResponseSchema.safeParse({ status: 'maybe' });
    expect(result.success).toBe(false);
  });
});
