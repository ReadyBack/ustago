import { Inject, Injectable, Logger } from '@nestjs/common';

import { httpError, notFound } from '../common/http/errors.js';
import { Prisma } from '../generated/prisma/client.js';
import type { WebhookEventOutcome } from '../generated/prisma/client.js';
import { metrics } from '../observability/metrics.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FINANCE_CONFIG, type FinanceConfig } from './finance.config.js';
import { PaymentsService } from './payments.service.js';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type PaymentWebhookEvent,
  WebhookVerificationError,
} from './providers/payment-provider.js';
import { RefundsService } from './refunds.service.js';

type Tx = Prisma.TransactionClient;

export interface WebhookResult {
  received: true;
  duplicate: boolean;
  outcome: WebhookEventOutcome | null;
}

const ATTEMPT_STATE = {
  'payment.pending': 'PENDING',
  'payment.succeeded': 'SUCCEEDED',
  'payment.failed': 'FAILED',
  'payment.cancelled': 'CANCELLED',
} as const;

/**
 * Payment provider webhooks (docs/adr/0019): the source of truth for money.
 *  1. verify signature and timestamp (replay window) → 401 otherwise;
 *  2. de-duplicate by (provider, event id): the same event 100 times is
 *     processed once (unique index, in the same DB transaction as the
 *     state change);
 *  3. apply forward-only: out-of-order events never move a state back.
 * Raw payloads are stored redacted; secrets never reach the logs.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(FINANCE_CONFIG) private readonly config: FinanceConfig,
  ) {}

  async handle(
    providerName: string,
    rawBody: Buffer | undefined,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<WebhookResult> {
    if (providerName !== this.provider.name || this.config.paymentProvider === 'disabled') {
      throw notFound('WEBHOOK_PROVIDER_UNKNOWN', 'Bilinmeyen ödeme sağlayıcısı.');
    }
    if (!rawBody || rawBody.length === 0) {
      throw httpError(400, 'WEBHOOK_MALFORMED', 'Boş webhook gövdesi.');
    }
    let event: PaymentWebhookEvent;
    try {
      event = this.provider.verifyWebhook({ rawBody, headers, now: new Date() });
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        this.logger.warn(`Rejected ${providerName} webhook: ${error.code}`);
        metrics.domainEvents.inc({ event: 'webhook.rejected' });
        if (error.code === 'WEBHOOK_MALFORMED') {
          throw httpError(400, error.code, 'Webhook gövdesi okunamadı.');
        }
        throw httpError(401, error.code, 'Webhook imzası doğrulanamadı.');
      }
      throw error;
    }

    const seen = await this.prisma.webhookEvent.findUnique({
      where: { provider_eventId: { provider: providerName, eventId: event.eventId } },
    });
    if (seen) {
      metrics.domainEvents.inc({ event: 'webhook.duplicate' });
      return { received: true, duplicate: true, outcome: seen.outcome };
    }

    let refundIds: string[] = [];
    let outcome: WebhookEventOutcome;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const applied = await this.apply(tx, event);
        await tx.webhookEvent.create({
          data: {
            provider: providerName,
            eventId: event.eventId,
            type: event.type,
            outcome: applied.outcome,
            payload: event.redactedPayload as Prisma.InputJsonObject,
            occurredAt: event.occurredAt,
          },
        });
        return applied;
      });
      refundIds = result.refundIds;
      outcome = result.outcome;
    } catch (error) {
      // The same event delivered twice at the same time: the second
      // transaction rolled back as a whole; the first one counts.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        metrics.domainEvents.inc({ event: 'webhook.duplicate' });
        return { received: true, duplicate: true, outcome: null };
      }
      throw error;
    }
    await this.refunds.processAll(refundIds);
    return { received: true, duplicate: false, outcome };
  }

  private async apply(
    tx: Tx,
    event: PaymentWebhookEvent,
  ): Promise<{ outcome: WebhookEventOutcome; refundIds: string[] }> {
    if (event.type.startsWith('payment.')) {
      const attempt = event.providerPaymentId
        ? await tx.paymentTransaction.findUnique({
            where: {
              gateway_gatewayTransactionId: {
                gateway: this.provider.name,
                gatewayTransactionId: event.providerPaymentId,
              },
            },
          })
        : null;
      if (!attempt) return { outcome: 'IGNORED_UNKNOWN', refundIds: [] };
      if (event.amountMinor !== undefined && event.amountMinor !== attempt.amountMinor) {
        // Never book a different amount than we asked for.
        this.logger.error(`Webhook ${event.eventId}: amount does not match attempt ${attempt.id}`);
        return { outcome: 'IGNORED_UNKNOWN', refundIds: [] };
      }
      const state = ATTEMPT_STATE[event.type as keyof typeof ATTEMPT_STATE];
      return this.payments.applyAttemptOutcome(tx, attempt.id, state, event.failureCode ?? null);
    }
    const refund = event.providerRefundId
      ? await tx.refund.findFirst({ where: { gatewayRefundId: event.providerRefundId } })
      : null;
    if (!refund) return { outcome: 'IGNORED_UNKNOWN', refundIds: [] };
    if (refund.status !== 'REQUESTED') return { outcome: 'IGNORED_STALE', refundIds: [] };
    if (event.type === 'refund.succeeded') {
      await this.refunds.complete(refund.id, event.providerRefundId ?? null, tx);
    } else {
      await this.refunds.fail(refund.id, event.failureCode ?? 'PROVIDER_REFUSED', undefined, tx);
    }
    return { outcome: 'PROCESSED', refundIds: [] };
  }
}
