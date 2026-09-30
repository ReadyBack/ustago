/**
 * Port for online payments (docs/adr/0019). The finance domain only knows
 * this interface. MockPaymentProvider is for development and tests; a real
 * adapter (iyzico, PayTR, …) is written only after its official API and
 * merchant requirements are verified, never from assumptions.
 *
 * Card data never passes through UstaGO: a real adapter uses the
 * provider's hosted payment page or tokens.
 */

export type ProviderPaymentState = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface CreatePaymentInput {
  paymentId: string;
  attemptId: string;
  amountMinor: bigint;
  currency: 'TRY';
  /** Sent to the provider so a retried call never charges twice. */
  idempotencyKey: string;
  description: string;
}

export interface CreatePaymentResult {
  providerPaymentId: string;
  /** Mock always answers PENDING: money is confirmed by a webhook only. */
  state: ProviderPaymentState;
  failureCode?: string;
}

export interface RefundInput {
  providerPaymentId: string;
  refundId: string;
  amountMinor: bigint;
  currency: 'TRY';
  idempotencyKey: string;
}

export interface RefundResult {
  providerRefundId: string;
  state: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  failureCode?: string;
}

/** A verified provider event, normalised. */
export interface PaymentWebhookEvent {
  eventId: string;
  type:
    | 'payment.pending'
    | 'payment.succeeded'
    | 'payment.failed'
    | 'payment.cancelled'
    | 'refund.succeeded'
    | 'refund.failed';
  occurredAt: Date;
  providerPaymentId?: string;
  providerRefundId?: string;
  amountMinor?: bigint;
  currency?: string;
  failureCode?: string;
  /** Payload with sensitive fields removed, safe to store. */
  redactedPayload: Record<string, unknown>;
}

export interface WebhookRequest {
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  now: Date;
}

export class WebhookVerificationError extends Error {
  constructor(
    message: string,
    readonly code:
      'WEBHOOK_SIGNATURE_INVALID' | 'WEBHOOK_TIMESTAMP_OUT_OF_RANGE' | 'WEBHOOK_MALFORMED',
  ) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

export interface PaymentProvider {
  /** "mock", later "iyzico", "paytr" … Stored as payments.gateway. */
  readonly name: string;
  /** True for test adapters: no real money ever moves. */
  readonly isTestMode: boolean;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  getPayment(providerPaymentId: string): Promise<ProviderPaymentState | null>;
  cancelPayment(providerPaymentId: string): Promise<void>;
  refundPayment(input: RefundInput): Promise<RefundResult>;
  /** Verifies the signature and timestamp; throws WebhookVerificationError. */
  verifyWebhook(request: WebhookRequest): PaymentWebhookEvent;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

/**
 * The payout provider definitely refused the payout (e.g. invalid account):
 * the money can be released. Any other error means the outcome is unknown
 * and the payout goes to NEEDS_RECONCILIATION (Faz 6).
 */
export class PayoutRejectedError extends Error {
  constructor(readonly code: string) {
    super(`Payout rejected: ${code}`);
    this.name = 'PayoutRejectedError';
  }
}

/** Payouts to providers' bank accounts (docs/adr/0020). */
export interface PayoutProvider {
  readonly name: string;
  readonly isTestMode: boolean;
  /** Hands the payout to the provider; the result arrives later. */
  createPayout(input: {
    payoutId: string;
    amountMinor: bigint;
    currency: 'TRY';
    idempotencyKey: string;
  }): Promise<{ providerPayoutId: string }>;
}

export const PAYOUT_PROVIDER = Symbol('PAYOUT_PROVIDER');
