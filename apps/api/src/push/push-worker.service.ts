import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { API_ENV, type ApiEnv } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  isDeadTokenError,
  isRetryableTicketError,
  PUSH_PROVIDER,
  type PushProvider,
  type PushTicketResult,
  PushTransportError,
} from './push-provider.js';
import { CLAIM_LEASE_SECONDS, retryDecision } from './push-retry.js';

const BATCH = 50;
const RECEIPT_BATCH = 300;

export interface PushRunResult {
  claimed: number;
  sent: number;
  devLogged: number;
  skipped: number;
  retried: number;
  failed: number;
}

/**
 * Sends the push outbox (docs/adr/0017). Runs outside any business
 * transaction: rows are claimed with FOR UPDATE SKIP LOCKED (several API
 * instances can run it), the external HTTP call happens after the claim
 * committed, and the outcome is written back. A failed push never touches
 * the in-app notification. Delivery attempts live in push_deliveries /
 * push_tickets, not in the business audit log.
 */
@Injectable()
export class PushWorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PushWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_PROVIDER) private readonly provider: PushProvider,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  onApplicationBootstrap(): void {
    const seconds = this.env.PUSH_WORKER_INTERVAL_SECONDS;
    if (seconds === 0 || this.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), seconds * 1000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.runOnce();
      if (result.claimed > 0) {
        this.logger.log(
          `Push (${this.provider.name}): ${result.sent} sent, ${result.devLogged} dev-logged, ` +
            `${result.skipped} skipped, ${result.retried} retry, ${result.failed} failed`,
        );
      }
      await this.checkReceipts();
    } catch (error) {
      this.logger.error('Push worker run failed', error instanceof Error ? error.stack : String(error));
    } finally {
      this.running = false;
    }
  }

  /** Claims and sends one batch. Returns counts per outcome. */
  async runOnce(now = new Date()): Promise<PushRunResult> {
    const result: PushRunResult = {
      claimed: 0,
      sent: 0,
      devLogged: 0,
      skipped: 0,
      retried: 0,
      failed: 0,
    };
    const lease = new Date(now.getTime() + CLAIM_LEASE_SECONDS * 1000);
    const claimed = await this.prisma.$queryRaw<{ id: string; attempt_count: number }[]>`
      UPDATE push_deliveries SET
        attempt_count = attempt_count + 1,
        last_attempt_at = ${now},
        next_attempt_at = ${lease},
        updated_at = now()
      WHERE id IN (
        SELECT id FROM push_deliveries
        WHERE status = 'PENDING' AND next_attempt_at <= ${now}
        ORDER BY next_attempt_at
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, attempt_count`;
    result.claimed = claimed.length;

    for (const row of claimed) {
      const outcome = await this.deliver(row.id, row.attempt_count, now);
      result[outcome] += 1;
    }
    return result;
  }

  private async deliver(
    deliveryId: string,
    attempts: number,
    now: Date,
  ): Promise<keyof Omit<PushRunResult, 'claimed'>> {
    const delivery = await this.prisma.pushDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
      include: { notification: true },
    });
    const n = delivery.notification;

    if (this.provider.name === 'disabled') {
      await this.finish(deliveryId, 'SKIPPED', 'push disabled (PUSH_PROVIDER=disabled)');
      return 'skipped';
    }

    const devices = await this.prisma.device.findMany({
      where: {
        userId: n.userId,
        revokedAt: null,
        pushProvider: 'EXPO',
        pushToken: { not: null },
      },
      select: { id: true, pushToken: true },
    });
    if (devices.length === 0) {
      await this.finish(deliveryId, 'SKIPPED', 'no registered push device');
      return 'skipped';
    }

    const data = isStringRecord(n.data) ? { ...n.data, notificationId: n.id } : { notificationId: n.id };
    let tickets: PushTicketResult[];
    try {
      tickets = await this.provider.send(
        devices.map((d) => ({ to: d.pushToken ?? '', title: n.title, body: n.body, data })),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = !(error instanceof PushTransportError) || error.retryable;
      return this.retryOrFail(deliveryId, attempts, now, message, retryable);
    }

    await this.prisma.pushTicket.createMany({
      data: tickets.map((t, i) => ({
        deliveryId,
        deviceId: devices[i]?.id ?? '',
        provider: this.provider.name,
        ticketId: t.status === 'ok' ? t.ticketId : null,
        status: t.status === 'ok' ? ('OK' as const) : ('ERROR' as const),
        error: t.status === 'error' ? t.error.slice(0, 100) : null,
        receiptStatus:
          t.status === 'ok' && t.ticketId ? ('PENDING' as const) : ('NOT_APPLICABLE' as const),
      })),
    });
    for (const [i, t] of tickets.entries()) {
      const device = devices[i];
      if (t.status === 'error' && device && isDeadTokenError(t.error)) {
        await this.invalidateToken(device.id, device.pushToken, now);
      }
    }

    if (tickets.some((t) => t.status === 'ok')) {
      if (!this.provider.delivers) {
        await this.finish(deliveryId, 'DEV_LOGGED', 'console provider: logged, not sent');
        return 'devLogged';
      }
      await this.prisma.pushDelivery.update({
        where: { id: deliveryId },
        data: { status: 'SENT', sentAt: now, lastError: null },
      });
      return 'sent';
    }
    const errors = tickets.map((t) => (t.status === 'error' ? t.error : '')).join(', ');
    const retryable = tickets.some((t) => t.status === 'error' && isRetryableTicketError(t.error));
    return this.retryOrFail(deliveryId, attempts, now, errors, retryable);
  }

  private async retryOrFail(
    deliveryId: string,
    attempts: number,
    now: Date,
    message: string,
    retryable: boolean,
  ): Promise<'retried' | 'failed'> {
    const decision = retryable
      ? retryDecision(attempts, this.env.PUSH_MAX_ATTEMPTS, now)
      : ({ retry: false } as const);
    if (decision.retry) {
      await this.prisma.pushDelivery.update({
        where: { id: deliveryId },
        data: { nextAttemptAt: decision.nextAttemptAt, lastError: message.slice(0, 500) },
      });
      return 'retried';
    }
    await this.finish(deliveryId, 'FAILED', message);
    return 'failed';
  }

  private async finish(
    deliveryId: string,
    status: 'SKIPPED' | 'FAILED' | 'DEV_LOGGED',
    message: string,
  ): Promise<void> {
    await this.prisma.pushDelivery.update({
      where: { id: deliveryId },
      data: { status, lastError: message.slice(0, 500) },
    });
  }

  /** Clears a dead token, unless the device already registered a newer one. */
  private async invalidateToken(deviceId: string, token: string | null, now: Date): Promise<void> {
    if (!token) return;
    await this.prisma.device.updateMany({
      where: { id: deviceId, pushToken: token },
      data: { pushToken: null, pushTokenInvalidatedAt: now },
    });
  }

  /**
   * Reads Expo receipts for tickets older than PUSH_RECEIPT_DELAY_SECONDS.
   * DeviceNotRegistered clears the token so it is never used again.
   */
  async checkReceipts(now = new Date()): Promise<number> {
    if (!this.provider.delivers) return 0;
    const before = new Date(now.getTime() - this.env.PUSH_RECEIPT_DELAY_SECONDS * 1000);
    const tickets = await this.prisma.pushTicket.findMany({
      where: { receiptStatus: 'PENDING', ticketId: { not: null }, createdAt: { lte: before } },
      include: { device: { select: { id: true, pushToken: true } } },
      orderBy: { createdAt: 'asc' },
      take: RECEIPT_BATCH,
    });
    if (tickets.length === 0) return 0;
    const receipts = await this.provider.receipts(tickets.flatMap((t) => (t.ticketId ? [t.ticketId] : [])));
    let checked = 0;
    for (const t of tickets) {
      const receipt = t.ticketId ? receipts.get(t.ticketId) : undefined;
      if (!receipt) continue;
      checked += 1;
      await this.prisma.pushTicket.update({
        where: { id: t.id },
        data: {
          receiptStatus: receipt.status === 'ok' ? 'OK' : 'ERROR',
          receiptError: receipt.status === 'error' ? receipt.error.slice(0, 100) : null,
          receiptCheckedAt: now,
        },
      });
      if (receipt.status === 'error' && isDeadTokenError(receipt.error)) {
        await this.invalidateToken(t.device.id, t.device.pushToken, now);
      }
    }
    return checked;
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === 'string')
  );
}
