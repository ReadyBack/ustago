import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { HeartbeatService, WORKERS } from '../ops/heartbeat.service.js';
import { API_ENV, type ApiEnv } from '../config/env.js';
import { EarningsService } from './earnings.service.js';
import { FINANCE_CONFIG, type FinanceConfig } from './finance.config.js';
import { RefundsService } from './refunds.service.js';

/**
 * Background finance sweep: releases earnings whose hold period passed and
 * retries refunds that are still waiting for the payment provider. Both
 * are idempotent (conditional updates, unique ledger source keys), so
 * several API instances may run it at once. Off in tests (the suites call
 * the methods directly).
 */
@Injectable()
export class FinanceSweepService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(FinanceSweepService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly earnings: EarningsService,
    private readonly refunds: RefundsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(FINANCE_CONFIG) private readonly config: FinanceConfig,
    private readonly heartbeat: HeartbeatService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.sweep(), this.config.sweepSeconds * 1000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { released, retried } = await this.heartbeat.track(
        WORKERS.FINANCE_SWEEP,
        async () => ({
          released: await this.earnings.releaseDue(now),
          retried: await this.refunds.retryStale(60, now),
        }),
        (r) => r,
      );
      if (released + retried > 0) {
        this.logger.log(
          `Finance sweep: ${released} earning(s) released, ${retried} refund(s) retried`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Finance sweep failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }
}
