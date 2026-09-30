import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { API_ENV, type ApiEnv } from '../config/env.js';
import { QualityService } from './quality.service.js';

const SWEEP_SECONDS = 300;

/**
 * Every five minutes: expires sanctions whose end time passed and
 * refreshes UstaScore snapshots older than a day. Both are idempotent, so
 * overlapping runs on several instances are harmless. Off in tests (the
 * suites call the methods directly).
 */
@Injectable()
export class QualitySweepService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(QualitySweepService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly quality: QualityService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_SECONDS * 1000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async sweep(): Promise<void> {
    try {
      const expired = await this.quality.expireDuePenalties();
      const refreshed = await this.quality.refreshStale();
      if (expired + refreshed > 0) {
        this.logger.log(
          `Quality sweep: ${expired} sanction(s) expired, ${refreshed} score(s) refreshed`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Quality sweep failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
