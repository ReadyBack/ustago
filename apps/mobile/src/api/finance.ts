import type {
  JobPaymentSummary,
  MockPaymentOutcome,
  MyPaymentDetail,
  MyPaymentListItem,
  Paginated,
  Payment,
  PaymentMethodChoice,
  Payout,
  PayoutDestination,
  ProviderEarning,
  Wallet,
  WalletLine,
} from '@ustago/types';

import { api } from './session';

/**
 * Typed calls for payments, cash settlements, the provider wallet and
 * payouts (Faz 5). Every amount is integer kuruş. Calls that move money
 * send an Idempotency-Key the caller keeps for retries of the same tap.
 */

const page = (limit: number, cursor?: string) =>
  `limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;

const idempotent = (key: string) => ({ headers: { 'Idempotency-Key': key } });

export const paymentApi = {
  summary: (jobId: string) => api.get<JobPaymentSummary>(`/jobs/${jobId}/payment-summary`),
  chooseMethod: (jobId: string, method: PaymentMethodChoice) =>
    api.put<JobPaymentSummary>(`/jobs/${jobId}/payment-method`, { method }),
  /** Starts an online payment for what is still due; the server computes the amount. */
  create: (jobId: string, idempotencyKey: string) =>
    api.post<Payment>(`/jobs/${jobId}/payments`, undefined, idempotent(idempotencyKey)),
  /** DEV ONLY: exists only while the API runs the mock payment provider. */
  simulate: (paymentId: string, outcome: MockPaymentOutcome) =>
    api.post<Payment>(`/dev/payments/${paymentId}/simulate`, { outcome }),
  confirmCash: (jobId: string) => api.post<JobPaymentSummary>(`/jobs/${jobId}/cash/confirm`),
  disputeCash: (jobId: string, note: string) =>
    api.post<JobPaymentSummary>(`/jobs/${jobId}/cash/dispute`, { note }),
  mine: (cursor?: string) =>
    api.get<Paginated<MyPaymentListItem>>(`/me/payments?${page(25, cursor)}`),
  mineDetail: (id: string) => api.get<MyPaymentDetail>(`/me/payments/${id}`),
};

export const walletApi = {
  get: () => api.get<Wallet>('/me/wallet'),
  transactions: (cursor?: string) =>
    api.get<Paginated<WalletLine>>(`/me/wallet/transactions?${page(25, cursor)}`),
  earnings: (cursor?: string) =>
    api.get<Paginated<ProviderEarning>>(`/me/earnings?${page(25, cursor)}`),
  earning: (id: string) => api.get<ProviderEarning>(`/me/earnings/${id}`),
};

export const payoutApi = {
  destination: () => api.get<PayoutDestination | null>('/me/payout-destination'),
  setDestination: (holderName: string, iban: string) =>
    api.put<PayoutDestination>('/me/payout-destination', { holderName, iban }),
  list: (cursor?: string) => api.get<Paginated<Payout>>(`/me/payouts?${page(25, cursor)}`),
  request: (amountMinor: number, idempotencyKey: string) =>
    api.post<Payout>('/me/payouts', { amountMinor }, idempotent(idempotencyKey)),
  cancel: (id: string) => api.post<Payout>(`/me/payouts/${id}/cancel`),
};
