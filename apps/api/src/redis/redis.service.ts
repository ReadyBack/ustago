import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

import { API_ENV, type ApiEnv } from '../config/env.js';

/**
 * Shared Redis connection. BullMQ queues added in later phases create their
 * own connections from the same REDIS_URL.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.client.on('error', (error: Error) => this.logger.warn(`Redis error: ${error.message}`));
  }

  async ping(): Promise<void> {
    await (await this.connected()).ping();
  }

  /** Returns the client, opening the lazy connection on first use. */
  async connected(): Promise<Redis> {
    if (this.client.status === 'wait' || this.client.status === 'end') {
      await this.client.connect();
    }
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status !== 'end' && this.client.status !== 'wait') {
      await this.client.quit();
    } else {
      this.client.disconnect();
    }
  }
}
