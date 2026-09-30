import type {
  CashSettlementStatus,
  PaymentMethodChoice,
  PaymentStatus,
  PayoutStatus,
  ProviderEarningStatus,
  WalletBucket,
} from '@ustago/types';
import {
  CASH_STATUS_LABELS,
  EARNING_STATUS_LABELS,
  formatMoney,
  parseTryInput,
  PAYMENT_STATUS_LABELS,
  PAYOUT_STATUS_LABELS,
} from '@ustago/validation';

import { ApiError } from '../api/client';
import { newIdempotencyKey } from './id';
import type { Tone } from './theme';

type Label = { label: string; tone: Tone };

/** Shown on every screen that talks to the mock payment provider. */
export const TEST_BANNER = 'TEST ÖDEME ORTAMI — gerçek ücret alınmaz';
export const PAYMENT_FAILED_MESSAGE = 'Ödeme alınamadı. Lütfen tekrar deneyin.';
export const CARD_DECLINED_MESSAGE = 'Kart reddedildi. Lütfen başka bir kartla tekrar deneyin.';

export const PAYMENT_METHOD_LABEL: Record<PaymentMethodChoice, string> = {
  IN_APP: 'Uygulamadan öde',
  CASH: 'Ustaya doğrudan öde',
};

const PAYMENT_TONE: Record<PaymentStatus, Tone> = {
  PENDING: 'warning',
  AUTHORIZED: 'info',
  SUCCEEDED: 'success',
  PARTIALLY_REFUNDED: 'info',
  REFUNDED: 'neutral',
  FAILED: 'danger',
  CANCELLED: 'neutral',
  DISPUTED: 'danger',
  SETTLED_OFFLINE: 'success',
};

const CASH_TONE: Record<CashSettlementStatus, Tone> = {
  AWAITING_CONFIRMATION: 'warning',
  CUSTOMER_CONFIRMED: 'info',
  PROVIDER_CONFIRMED: 'info',
  CONFIRMED: 'success',
  DISPUTED: 'danger',
  RESOLVED_UNPAID: 'neutral',
};

const PAYOUT_TONE: Record<PayoutStatus, Tone> = {
  REQUESTED: 'warning',
  APPROVED: 'info',
  PROCESSING: 'info',
  PAID: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};

const EARNING_TONE: Record<ProviderEarningStatus, Tone> = {
  PENDING: 'warning',
  HELD: 'danger',
  AVAILABLE: 'success',
  REVERSED: 'neutral',
};

export function paymentStatus(status: PaymentStatus): Label {
  return { label: PAYMENT_STATUS_LABELS[status], tone: PAYMENT_TONE[status] };
}

export function cashStatus(status: CashSettlementStatus): Label {
  return { label: CASH_STATUS_LABELS[status], tone: CASH_TONE[status] };
}

/** "Ödemelerim" rows mix online payment and cash statuses. */
export function anyPaymentStatus(status: PaymentStatus | CashSettlementStatus): Label {
  return status in CASH_TONE
    ? cashStatus(status as CashSettlementStatus)
    : paymentStatus(status as PaymentStatus);
}

export function payoutStatus(status: PayoutStatus): Label {
  return { label: PAYOUT_STATUS_LABELS[status], tone: PAYOUT_TONE[status] };
}

export function earningStatus(status: ProviderEarningStatus): Label {
  return { label: EARNING_STATUS_LABELS[status], tone: EARNING_TONE[status] };
}

export const WALLET_BUCKET_LABEL: Record<WalletBucket, string> = {
  PENDING: 'Bekleyen',
  AVAILABLE: 'Kullanılabilir',
  RESERVED: 'Ayrılan',
  PLATFORM_DEBT: 'Platform borcu',
};

/** Why a payment failed, in plain Turkish; technical codes never reach the user. */
export function paymentFailureMessage(code: string | null): string {
  return code === 'CARD_DECLINED' ? CARD_DECLINED_MESSAGE : PAYMENT_FAILED_MESSAGE;
}

const MESSAGES: Record<string, string> = {
  PAYMENT_NOTHING_DUE: 'Bu iş için ödenecek tutar kalmadı.',
  PAYMENT_METHOD_LOCKED: 'Ödeme yöntemi artık değiştirilemez.',
  PAYMENT_METHOD_IS_CASH: 'Bu iş için ustaya doğrudan ödeme seçildi.',
  PAYMENT_NOT_ALLOWED: 'Bu iş için şu anda ödeme yapılamaz.',
  PAYMENT_WRONG_PARTY: 'Bu işlem işin diğer tarafına ait.',
  PAYMENTS_DISABLED: 'Uygulamadan ödeme şu anda kapalı. Lütfen daha sonra tekrar deneyin.',
  CASH_DISABLED: 'Ustaya doğrudan ödeme şu anda kullanılamıyor.',
  CASH_NOT_SELECTED: 'Bu iş için ustaya doğrudan ödeme seçilmedi.',
  CASH_NOT_ALLOWED: 'Nakit ödeme onayı şu anda yapılamaz.',
  CASH_INVALID_STATE: 'Ödeme durumu değişti. Güncel durum gösteriliyor.',
  INSUFFICIENT_AVAILABLE_BALANCE: 'Çekilebilir bakiyeniz bu tutar için yeterli değil.',
  PAYOUT_BELOW_MINIMUM: 'Tutar en düşük para çekme tutarının altında.',
  PAYOUT_DESTINATION_REQUIRED: 'Önce para çekeceğiniz banka hesabını kaydedin.',
  PAYOUT_INVALID_STATE: 'Bu talep artık iptal edilemez. Güncel durum gösteriliyor.',
  FINANCE_RATE_LIMITED: 'Çok sık denediniz. Lütfen biraz bekleyip tekrar deneyin.',
  IDEMPOTENCY_KEY_REUSED: 'Bu işlem zaten gönderildi. Güncel durum gösteriliyor.',
  VALIDATION_FAILED: 'Girdiğiniz bilgileri kontrol edin.',
};

/** Rethrows with a friendly message; unknown codes keep the server's Turkish message. */
export function toFinanceError(error: unknown): unknown {
  if (!(error instanceof ApiError)) return error;
  let message = MESSAGES[error.code];
  if (!message) return error;
  if (error.code === 'FINANCE_RATE_LIMITED' && error.retryAfterSeconds) {
    message = `Çok sık denediniz. Lütfen ${error.retryAfterSeconds} saniye sonra tekrar deneyin.`;
  }
  return new ApiError(error.status, error.code, message, error.details);
}

/** Codes after which the screen reloads: the state changed elsewhere. */
export function isStaleFinanceError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 409 || error.status === 422);
}

/**
 * Lira typed by the user ("1.000,50", "1000.5", "250") to integer kuruş,
 * digit by digit (no floating point); null when it is not a clear amount.
 */
export function parseAmountMinor(text: string): number | null {
  return parseTryInput(text);
}

/**
 * One Idempotency-Key per user intent: a retry after a network failure or a
 * server error reuses the key (the server answers with the first result and
 * never moves money twice); any definite answer starts a new intent.
 */
export class IntentKey {
  private key: string | null = null;
  private fingerprint = '';

  /** The key for this request; a different body (fingerprint) is a new intent. */
  current(fingerprint = ''): string {
    if (this.key === null || fingerprint !== this.fingerprint) {
      this.key = newIdempotencyKey();
      this.fingerprint = fingerprint;
    }
    return this.key;
  }

  /** Call after the request settles. Keeps the key only when the outcome is unknown. */
  settle(error?: unknown): void {
    const unknownOutcome = error instanceof ApiError && (error.status === 0 || error.status >= 500);
    if (!unknownOutcome) this.key = null;
  }
}

/** "+₺150" / "-₺45,50" for a signed wallet change. */
export function formatSigned(amountMinor: number): string {
  return `${amountMinor > 0 ? '+' : ''}${formatMoney(amountMinor)}`;
}
