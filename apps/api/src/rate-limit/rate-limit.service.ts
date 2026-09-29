import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { tooManyRequests } from '../common/http/errors.js';
import { API_ENV, type ApiEnv } from '../config/env.js';
import { RedisService } from '../redis/redis.service.js';

export interface RateLimitCheck {
  bucket: string;
  subject: string;
  limit?: number;
  windowSeconds?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Fixed-window counters in Redis, shared by every API instance. Keys hold a
 * hash, never a raw e-mail. If Redis is unreachable the request is allowed
 * and a warning is logged, so a cache outage cannot lock everyone out.
 */
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(
    private readonly redis: RedisService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async hit(
    bucket: string,
    subject: string,
    limit = this.env.AUTH_RATE_LIMIT_MAX,
    windowSeconds = this.env.AUTH_RATE_LIMIT_WINDOW_SECONDS,
  ): Promise<RateLimitResult> {
    const key = `rl:${bucket}:${createHash('sha256').update(subject).digest('hex').slice(0, 32)}`;
    try {
      const client = await this.redis.connected();
      const results = await client
        .multi()
        .incr(key)
        .expire(key, windowSeconds, 'NX')
        .ttl(key)
        .exec();
      const count = Number(results?.[0]?.[1] ?? 0);
      const ttl = Number(results?.[2]?.[1] ?? windowSeconds);
      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
      };
    } catch (error) {
      this.logger.warn(
        `Rate limiter unavailable, allowing request: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
    }
  }

  /**
   * Throws 429 when any of the buckets is exhausted. Checks use the auth
   * defaults unless they set their own `limit` / `windowSeconds`.
   */
  async enforce(...checks: RateLimitCheck[]): Promise<void> {
    await this.enforceWithCode('RATE_LIMITED', ...checks);
  }

  /** Same as enforce() with a domain-specific error code (e.g. OTP_RATE_LIMITED). */
  async enforceWithCode(code: string, ...checks: RateLimitCheck[]): Promise<void> {
    const results = await Promise.all(
      checks.map((c) => this.hit(c.bucket, c.subject, c.limit, c.windowSeconds)),
    );
    const blocked = results.filter((r) => !r.allowed);
    if (blocked.length > 0) {
      throw tooManyRequests(Math.max(...blocked.map((r) => r.retryAfterSeconds)), code);
    }
  }
}
