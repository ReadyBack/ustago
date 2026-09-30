import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { redact } from '../redact.js';
import {
  type CreatePaymentInput,
  type CreatePaymentResult,
  type PaymentProvider,
  type PaymentWebhookEvent,
  type ProviderPaymentState,
  type RefundInput,
  type RefundResult,
  type WebhookRequest,
  WebhookVerificationError,
} from './payment-provider.js';

export const MOCK_SIGNATURE_HEADER = 'ustago-mock-signature';

type MockOutcome = 'SUCCESS' | 'CARD_DECLINED' | 'TIMEOUT' | 'PROVIDER_ERROR' | 'CANCELLED';

interface MockPayment {
  amountMinor: bigint;
  state: ProviderPaymentState;
}

/**
 * TEST payment provider. It never touches real money: it records the
 * requested amount in memory and, when the (development-only) test screen
 * asks for an outcome, produces a signed webhook exactly like a real
 * provider would. The payment only succeeds once that webhook passes
 * signature verification, so the "provider is the source of truth" path is
 * exercised end to end. Refunds succeed immediately.
 *
 * Refused in production (packages/config api-env.ts and FinanceConfig).
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  readonly isTestMode = true;
  private readonly payments = new Map<string, MockPayment>();

  constructor(
    private readonly secret: Buffer,
    private readonly toleranceSeconds: number,
  ) {}

  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const providerPaymentId = `mock_pay_${input.attemptId}`;
    this.payments.set(providerPaymentId, { amountMinor: input.amountMinor, state: 'PENDING' });
    return Promise.resolve({ providerPaymentId, state: 'PENDING' });
  }

  getPayment(providerPaymentId: string): Promise<ProviderPaymentState | null> {
    return Promise.resolve(this.payments.get(providerPaymentId)?.state ?? null);
  }

  cancelPayment(providerPaymentId: string): Promise<void> {
    const p = this.payments.get(providerPaymentId);
    if (p && p.state === 'PENDING') p.state = 'CANCELLED';
    return Promise.resolve();
  }

  refundPayment(input: RefundInput): Promise<RefundResult> {
    return Promise.resolve({ providerRefundId: `mock_ref_${input.refundId}`, state: 'SUCCEEDED' });
  }

  /**
   * Development-only: the provider "decides" an attempt. Returns the signed
   * webhook the provider would send, for the webhook handler.
   */
  simulate(
    providerPaymentId: string,
    outcome: MockOutcome,
    amountMinor: bigint,
    now = new Date(),
  ): { rawBody: Buffer; headers: Record<string, string> } {
    const known = this.payments.get(providerPaymentId);
    const state: ProviderPaymentState =
      outcome === 'SUCCESS' ? 'SUCCEEDED' : outcome === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
    if (known) known.state = state;
    return this.signedEvent(
      {
        type:
          outcome === 'SUCCESS'
            ? 'payment.succeeded'
            : outcome === 'CANCELLED'
              ? 'payment.cancelled'
              : 'payment.failed',
        data: {
          providerPaymentId,
          amountMinor: amountMinor.toString(),
          currency: 'TRY',
          ...(state === 'FAILED' ? { failureCode: outcome } : {}),
        },
      },
      now,
    );
  }

  /** Builds and signs an arbitrary event (tests: replay, out-of-order). */
  signedEvent(
    event: { id?: string; type: string; created?: number; data: Record<string, unknown> },
    now = new Date(),
  ): { rawBody: Buffer; headers: Record<string, string> } {
    const created = event.created ?? Math.floor(now.getTime() / 1000);
    const body = JSON.stringify({
      id: event.id ?? `evt_${randomUUID()}`,
      type: event.type,
      created,
      data: event.data,
    });
    const timestamp = Math.floor(now.getTime() / 1000);
    return {
      rawBody: Buffer.from(body, 'utf8'),
      headers: {
        'content-type': 'application/json',
        [MOCK_SIGNATURE_HEADER]: `t=${timestamp},v1=${this.sign(timestamp, body)}`,
      },
    };
  }

  verifyWebhook(request: WebhookRequest): PaymentWebhookEvent {
    const header = request.headers[MOCK_SIGNATURE_HEADER];
    const value = Array.isArray(header) ? header[0] : header;
    if (!value) throw new WebhookVerificationError('missing signature', 'WEBHOOK_SIGNATURE_INVALID');
    const parts = Object.fromEntries(
      value.split(',').map((p) => {
        const i = p.indexOf('=');
        return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
      }),
    );
    const timestamp = Number(parts['t']);
    const signature = parts['v1'];
    if (!Number.isInteger(timestamp) || !signature) {
      throw new WebhookVerificationError('malformed signature', 'WEBHOOK_SIGNATURE_INVALID');
    }
    const expected = Buffer.from(this.sign(timestamp, request.rawBody.toString('utf8')), 'hex');
    const given = Buffer.from(signature, 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new WebhookVerificationError('bad signature', 'WEBHOOK_SIGNATURE_INVALID');
    }
    // Replay window: a captured request cannot be sent again later.
    const age = Math.abs(request.now.getTime() / 1000 - timestamp);
    if (age > this.toleranceSeconds) {
      throw new WebhookVerificationError('stale webhook', 'WEBHOOK_TIMESTAMP_OUT_OF_RANGE');
    }
    let parsed: { id?: unknown; type?: unknown; created?: unknown; data?: Record<string, unknown> };
    try {
      parsed = JSON.parse(request.rawBody.toString('utf8')) as typeof parsed;
    } catch {
      throw new WebhookVerificationError('invalid JSON', 'WEBHOOK_MALFORMED');
    }
    const types = [
      'payment.pending',
      'payment.succeeded',
      'payment.failed',
      'payment.cancelled',
      'refund.succeeded',
      'refund.failed',
    ] as const;
    const type = types.find((t) => t === parsed.type);
    if (typeof parsed.id !== 'string' || !type || typeof parsed.created !== 'number') {
      throw new WebhookVerificationError('unknown event', 'WEBHOOK_MALFORMED');
    }
    const data = parsed.data ?? {};
    const str = (key: string) => (typeof data[key] === 'string' ? (data[key] as string) : undefined);
    const amount = str('amountMinor');
    return {
      eventId: parsed.id,
      type,
      occurredAt: new Date(parsed.created * 1000),
      providerPaymentId: str('providerPaymentId'),
      providerRefundId: str('providerRefundId'),
      amountMinor: amount && /^\d+$/.test(amount) ? BigInt(amount) : undefined,
      currency: str('currency'),
      failureCode: str('failureCode'),
      redactedPayload: redact(parsed) as Record<string, unknown>,
    };
  }

  private sign(timestamp: number, body: string): string {
    return createHmac('sha256', this.secret).update(`${timestamp}.${body}`).digest('hex');
  }
}
