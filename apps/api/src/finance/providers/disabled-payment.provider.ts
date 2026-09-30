import {
  type PaymentProvider,
  PaymentProviderError,
  type PayoutProvider,
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
  createPayout = () =>
    Promise.reject(new PaymentProviderError('payouts are disabled', 'PAYOUTS_DISABLED'));
}

/**
 * PAYOUT_PROVIDER=mock: accepts the payout and never sends money. An admin
 * marks it paid or failed through development-only endpoints.
 */
export class MockPayoutProvider implements PayoutProvider {
  readonly name = 'mock';
  readonly isTestMode = true;
  createPayout(input: { payoutId: string }) {
    return Promise.resolve({ providerPayoutId: `mock_payout_${input.payoutId}` });
  }
}
