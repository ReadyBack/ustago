import { MockPaymentProvider, MOCK_SIGNATURE_HEADER } from './mock-payment.provider.js';
import { WebhookVerificationError } from './payment-provider.js';

const secret = Buffer.from('unit-test-webhook-secret-0123456789');

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof WebhookVerificationError ? error.code : 'OTHER';
  }
}

describe('MockPaymentProvider', () => {
  const provider = new MockPaymentProvider(secret, 300);
  const now = new Date('2026-10-01T12:00:00Z');

  it('never decides a payment on creation: it stays pending until a signed webhook', async () => {
    const created = await provider.createPayment({
      paymentId: 'p1',
      attemptId: 'a1',
      amountMinor: 220000n,
      currency: 'TRY',
      idempotencyKey: 'a1',
      description: 'UstaGO hizmet bedeli',
    });
    expect(created).toEqual({ providerPaymentId: 'mock_pay_a1', state: 'PENDING' });
    expect(provider.isTestMode).toBe(true);
  });

  it('verifies its own signed events', () => {
    const event = provider.simulate('mock_pay_a1', 'SUCCESS', 220000n, now);
    const verified = provider.verifyWebhook({
      rawBody: event.rawBody,
      headers: event.headers,
      now,
    });
    expect(verified.type).toBe('payment.succeeded');
    expect(verified.providerPaymentId).toBe('mock_pay_a1');
    expect(verified.amountMinor).toBe(220000n);
  });

  it('maps outcomes: declined / timeout / provider error fail, cancelled cancels', () => {
    for (const [outcome, type] of [
      ['CARD_DECLINED', 'payment.failed'],
      ['TIMEOUT', 'payment.failed'],
      ['PROVIDER_ERROR', 'payment.failed'],
      ['CANCELLED', 'payment.cancelled'],
    ] as const) {
      const e = provider.simulate('mock_pay_x', outcome, 1n, now);
      expect(provider.verifyWebhook({ rawBody: e.rawBody, headers: e.headers, now }).type).toBe(
        type,
      );
    }
  });

  it('rejects missing, wrong or tampered signatures and old timestamps', () => {
    const e = provider.simulate('mock_pay_a1', 'SUCCESS', 220000n, now);
    expect(codeOf(() => provider.verifyWebhook({ rawBody: e.rawBody, headers: {}, now }))).toBe(
      'WEBHOOK_SIGNATURE_INVALID',
    );
    const other = new MockPaymentProvider(Buffer.from('another-secret-another-secret-00'), 300);
    expect(codeOf(() => other.verifyWebhook({ rawBody: e.rawBody, headers: e.headers, now }))).toBe(
      'WEBHOOK_SIGNATURE_INVALID',
    );
    const tampered = Buffer.from(e.rawBody.toString().replace('220000', '220001'));
    expect(
      codeOf(() => provider.verifyWebhook({ rawBody: tampered, headers: e.headers, now })),
    ).toBe('WEBHOOK_SIGNATURE_INVALID');
    const later = new Date(now.getTime() + 301_000);
    expect(
      codeOf(() => provider.verifyWebhook({ rawBody: e.rawBody, headers: e.headers, now: later })),
    ).toBe('WEBHOOK_TIMESTAMP_OUT_OF_RANGE');
    expect(
      codeOf(() =>
        provider.verifyWebhook({
          rawBody: e.rawBody,
          headers: { [MOCK_SIGNATURE_HEADER]: 'garbage' },
          now,
        }),
      ),
    ).toBe('WEBHOOK_SIGNATURE_INVALID');
  });

  it('refunds succeed immediately with a deterministic id', async () => {
    await expect(
      provider.refundPayment({
        refundId: 'r1',
        providerPaymentId: 'mock_pay_a1',
        amountMinor: 100n,
        currency: 'TRY',
        idempotencyKey: 'r1',
      }),
    ).resolves.toEqual({ providerRefundId: 'mock_ref_r1', state: 'SUCCEEDED' });
  });
});
