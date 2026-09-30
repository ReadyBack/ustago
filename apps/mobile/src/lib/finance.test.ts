import { ApiError } from '../api/client';
import {
  anyPaymentStatus,
  formatSigned,
  IntentKey,
  parseAmountMinor,
  paymentFailureMessage,
  toFinanceError,
} from './finance';

describe('finance helpers', () => {
  it('parses lira typed by the user into integer kuruş', () => {
    expect(parseAmountMinor('1.000,50')).toBe(100050);
    expect(parseAmountMinor('1000,5')).toBe(100050);
    expect(parseAmountMinor('1000.50')).toBe(100050);
    expect(parseAmountMinor('250')).toBe(25000);
    expect(parseAmountMinor('0,07')).toBe(7);
    expect(parseAmountMinor('12,345')).toBeNull();
    expect(parseAmountMinor('abc')).toBeNull();
    expect(parseAmountMinor('')).toBeNull();
  });

  it('keeps one idempotency key per intent and retries with it only when the outcome is unknown', () => {
    const intent = new IntentKey();
    const first = intent.current('500');
    expect(first).toMatch(/^[A-Za-z0-9_-]{8,80}$/);
    intent.settle(new ApiError(0, 'NETWORK_ERROR', 'x'));
    expect(intent.current('500')).toBe(first);
    intent.settle(new ApiError(503, 'HTTP_503', 'x'));
    expect(intent.current('500')).toBe(first);
    expect(intent.current('600')).not.toBe(first);
    const second = intent.current('600');
    intent.settle(new ApiError(422, 'PAYOUT_BELOW_MINIMUM', 'x'));
    expect(intent.current('600')).not.toBe(second);
    const third = intent.current('600');
    intent.settle();
    expect(intent.current('600')).not.toBe(third);
  });

  it('maps error codes to friendly Turkish and keeps unknown server messages', () => {
    const mapped = toFinanceError(new ApiError(503, 'PAYMENTS_DISABLED', 'disabled')) as ApiError;
    expect(mapped.message).toBe(
      'Uygulamadan ödeme şu anda kapalı. Lütfen daha sonra tekrar deneyin.',
    );
    expect(mapped.code).toBe('PAYMENTS_DISABLED');
    const limited = toFinanceError(
      new ApiError(429, 'FINANCE_RATE_LIMITED', 'x', { retryAfterSeconds: 30 }),
    ) as ApiError;
    expect(limited.message).toBe('Çok sık denediniz. Lütfen 30 saniye sonra tekrar deneyin.');
    const unknown = new ApiError(400, 'SOMETHING_ELSE', 'Sunucu mesajı');
    expect(toFinanceError(unknown)).toBe(unknown);
  });

  it('describes payment failures without technical codes', () => {
    expect(paymentFailureMessage('CARD_DECLINED')).toBe(
      'Kart reddedildi. Lütfen başka bir kartla tekrar deneyin.',
    );
    expect(paymentFailureMessage('TIMEOUT')).toBe('Ödeme alınamadı. Lütfen tekrar deneyin.');
    expect(paymentFailureMessage(null)).toBe('Ödeme alınamadı. Lütfen tekrar deneyin.');
  });

  it('labels online and cash statuses and signs wallet changes', () => {
    expect(anyPaymentStatus('SUCCEEDED').label).toBe('Başarılı');
    expect(anyPaymentStatus('CUSTOMER_CONFIRMED').label).toBe('Müşteri onayladı');
    expect(formatSigned(18700)).toBe('+₺187');
    expect(formatSigned(-4550)).toBe('-₺45,50');
    expect(formatSigned(0)).toBe('₺0');
  });
});
