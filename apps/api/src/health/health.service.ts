import { Inject, Injectable } from '@nestjs/common';
import { isStrictEnv } from '@ustago/config';
import type { DependencyStatus, HealthResponse } from '@ustago/types';

import { withTimeout } from '../common/utils/with-timeout.js';
import { API_ENV, type ApiEnv } from '../config/env.js';
import { redactText } from '../observability/redact.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

const CHECK_TIMEOUT_MS = 2000;

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async check(): Promise<HealthResponse> {
    const [database, redis] = await Promise.all([
      this.probe('database', () => this.prisma.ping()),
      this.probe('redis', () => this.redis.ping()),
    ]);

    // The API cannot serve anything without the database; Redis only backs
    // queues and caches, so losing it degrades rather than downs the API.
    const status =
      database.status === 'down' ? 'down' : redis.status === 'down' ? 'degraded' : 'ok';

    return {
      status,
      version: this.env.APP_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      checks: { database, redis },
    };
  }

  private async probe(name: string, fn: () => Promise<void>): Promise<DependencyStatus> {
    const started = performance.now();
    try {
      await withTimeout(fn(), CHECK_TIMEOUT_MS, name);
      return { status: 'up', latencyMs: Math.round(performance.now() - started) };
    } catch (error) {
      // Public endpoint: in staging/production nothing but "down" is shown.
      if (isStrictEnv(this.env.APP_ENV)) return { status: 'down' };
      const message = error instanceof Error ? error.message.split('\n')[0] : 'unknown error';
      return { status: 'down', error: redactText(message ?? 'unknown error') };
    }
  }
}
