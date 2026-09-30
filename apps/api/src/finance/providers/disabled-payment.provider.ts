import {
  type PaymentProvider,
  PaymentProviderError,
  type PayoutProvider,
  PayoutRejectedError,
  WebhookVerificationError,
} from './payment-provider.js';

const unavailable = () =>
  Promise.reject(new PaymentProviderError('payments are disabled', 'PAYMENTS_DISABLED'));

/** PAYMENT_PROVIDER=disabled: every call is refused; nothing is charged. */
export class DisabledPaymentProvider implements PaymentProvider {
  readonly name = 'disabled';
  readonly isTestMode = false;
  createPayment = unavailable;
  getPayment = () => Promise.resolve(null);
  cancelPayment = () => Promise.resolve();
  refundPayment = unavailable;
  verifyWebhook(): never {
    throw new WebhookVerificationError('payments are disabled', 'WEBHOOK_SIGNATURE_INVALID');
  }
}

/** PAYOUT_PROVIDER=disabled. */
export class DisabledPayoutProvider implements PayoutProvider {
  readonly name = 'disabled';
  readonly isTestMode = false;
  createPayout = () => Promise.reject(new PayoutRejectedError('PAYOUTS_DISABLED'));
}

/** Test amounts that make the mock payout provider misbehave (kuruş part). */
export const MOCK_PAYOUT_UNKNOWN_KURUS = 13n;
export const MOCK_PAYOUT_REJECTED_KURUS = 14n;

/**
 * PAYOUT_PROVIDER=mock: accepts the payout and never sends money. An admin
 * marks it paid or failed through development-only endpoints.
 *
 * Test scenarios (Faz 6): an amount ending in ,13 kuruş simulates a lost
 * answer (timeout) and one ending in ,14 a definite bank rejection.
 */
export class MockPayoutProvider implements PayoutProvider {
  readonly name = 'mock';
  readonly isTestMode = true;
  createPayout(input: { payoutId: string; amountMinor: bigint }) {
    const kurus = input.amountMinor % 100n;
    if (kurus === MOCK_PAYOUT_UNKNOWN_KURUS) {
      return Promise.reject(new PaymentProviderError('mock payout timeout', 'PROVIDER_TIMEOUT'));
    }
    if (kurus === MOCK_PAYOUT_REJECTED_KURUS) {
      return Promise.reject(new PayoutRejectedError('MOCK_BANK_REJECTED'));
    }
    return Promise.resolve({ providerPayoutId: `mock_payout_${input.payoutId}` });
  }
}
