import {
  conflict,
  forbidden,
  notFound,
  serviceUnavailable,
  unprocessable,
} from '../common/http/errors.js';

/** Stable error codes of the finance endpoints (docs/api/README.md). */
export const paymentNotFound = () => notFound('PAYMENT_NOT_FOUND', 'Ödeme bulunamadı.');
export const paymentsDisabled = () =>
  serviceUnavailable('PAYMENTS_DISABLED', 'Uygulamadan ödeme şu anda kullanılamıyor.');
export const cashDisabled = () =>
  serviceUnavailable('CASH_DISABLED', 'Ustaya doğrudan ödeme şu anda kullanılamıyor.');
export const payoutsDisabled = () =>
  serviceUnavailable('PAYOUTS_DISABLED', 'Para çekme şu anda kullanılamıyor.');
export const feePolicyMissing = () =>
  serviceUnavailable('FEE_POLICY_MISSING', 'Ödeme şu anda alınamıyor. Lütfen daha sonra deneyin.');
export const paymentWrongParty = () =>
  forbidden('PAYMENT_WRONG_PARTY', 'Bu işlemi yalnızca işin müşterisi yapabilir.');
export const paymentNotAllowed = (status: string) =>
  conflict('PAYMENT_NOT_ALLOWED', 'İşin mevcut durumunda ödeme yapılamaz.', { status });
export const nothingDue = () =>
  conflict('PAYMENT_NOTHING_DUE', 'Bu iş için ödenecek tutar kalmadı.');
export const methodIsCash = () =>
  conflict('PAYMENT_METHOD_IS_CASH', 'Bu iş için "Ustaya doğrudan öde" seçildi.');
export const methodLocked = (reason: string) =>
  conflict('PAYMENT_METHOD_LOCKED', 'Ödeme yöntemi artık değiştirilemez.', { reason });
export const idempotencyKeyReused = () =>
  conflict(
    'IDEMPOTENCY_KEY_REUSED',
    'Bu istek anahtarı başka bir işlem için kullanıldı. Lütfen tekrar deneyin.',
  );
export const cashNotSelected = () =>
  conflict('CASH_NOT_SELECTED', 'Bu iş için doğrudan ödeme seçilmedi.');
export const cashNotAllowed = (status: string) =>
  conflict('CASH_NOT_ALLOWED', 'Nakit ödeme onayı yalnızca iş tamamlandıktan sonra verilir.', {
    status,
  });
export const cashInvalidState = (status: string) =>
  conflict('CASH_INVALID_STATE', 'Nakit ödeme kaydının mevcut durumunda bu işlem yapılamaz.', {
    status,
  });
export const refundNotAllowed = (status: string) =>
  conflict('REFUND_NOT_ALLOWED', 'Bu ödeme iade edilemez.', { status });
export const refundExceeds = (refundableMinor: number) =>
  unprocessable('REFUND_EXCEEDS_REFUNDABLE', 'İade tutarı iade edilebilir tutarı aşıyor.', {
    refundableMinor,
  });
export const refundStale = (refundableMinor: number) =>
  conflict(
    'REFUND_STALE',
    'İade edilebilir tutar değişti. Lütfen ekranı yenileyip tekrar onaylayın.',
    { refundableMinor },
  );
export const payoutNotFound = () => notFound('PAYOUT_NOT_FOUND', 'Para çekme talebi bulunamadı.');
export const payoutInvalidState = (status: string) =>
  conflict('PAYOUT_INVALID_STATE', 'Talebin mevcut durumunda bu işlem yapılamaz.', { status });
export const providerOnly = () =>
  forbidden('PROVIDER_ONLY', 'Bu işlem yalnızca usta hesabıyla yapılabilir.');
export const destinationRequired = () =>
  conflict('PAYOUT_DESTINATION_REQUIRED', 'Önce ödeme alınacak hesabı ekleyin.');
export const cashSettlementNotFound = () =>
  notFound('CASH_SETTLEMENT_NOT_FOUND', 'Nakit ödeme kaydı bulunamadı.');
export const earningNotFound = () => notFound('EARNING_NOT_FOUND', 'Kazanç kaydı bulunamadı.');
