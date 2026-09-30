import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { API_ENV, type ApiEnv } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Closes open requests whose `expires_at` passed (NOW after an hour, quotes
 * after two weeks by default) and expires their open quotes. Mutations do
 * not depend on this sweep: quoting and accepting check `expires_at`
 * themselves, the sweep only makes lists and counts accurate.
 *
 * A single-process interval is enough for one API instance; with several
 * instances it moves to a BullMQ repeatable job (the UPDATEs are
 * idempotent, so overlapping sweeps are harmless meanwhile).
 */
@Injectable()
export class RequestExpiryService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RequestExpiryService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  onApplicationBootstrap(): void {
    const seconds = this.env.REQUEST_EXPIRY_SWEEP_SECONDS;
    if (seconds === 0 || this.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.sweepSafely(), seconds * 1000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Returns the number of requests expired. */
  async sweep(now = new Date()): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const expired = await tx.$queryRaw<{ id: string }[]>`
        UPDATE service_requests
        SET status = 'EXPIRED', version = version + 1, updated_at = now()
        WHERE status IN ('PUBLISHED', 'MATCHING', 'QUOTED') AND expires_at <= ${now}
        RETURNING id`;
      if (expired.length === 0) return 0;
      const ids = expired.map((r) => r.id);
      await tx.quote.updateMany({
        where: {
          serviceRequestId: { in: ids },
          status: { in: ['PENDING_CUSTOMER', 'PENDING_PROVIDER'] },
        },
        data: { status: 'EXPIRED', version: { increment: 1 } },
      });
      await tx.emergencyDispatchOffer.updateMany({
        where: { serviceRequestId: { in: ids }, status: { in: ['SENT', 'SEEN'] } },
        data: { status: 'EXPIRED' },
      });
      await tx.auditLog.createMany({
        data: ids.map((id) => ({
          action: 'service_request.expired',
          entityType: 'service_request',
          entityId: id,
        })),
      });
      return ids.length;
    });
  }

  private async sweepSafely(): Promise<void> {
    try {
      const count = await this.sweep();
      if (count > 0) this.logger.log(`Expired ${count} service request(s)`);
    } catch (error) {
      this.logger.error(
        'Request expiry sweep failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
