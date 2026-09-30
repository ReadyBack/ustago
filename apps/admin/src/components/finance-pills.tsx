import type {
  CashSettlementStatus,
  PaymentAttemptStatus,
  PaymentStatus,
  PayoutStatus,
  ProviderEarningStatus,
  RefundStatus,
} from '@ustago/types';

import {
  ATTEMPT_STATUS_LABELS,
  CASH_STATUS_LABELS,
  EARNING_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYOUT_STATUS_LABELS,
  REFUND_STATUS_LABELS,
} from '@/lib/labels';

const PAYMENT_TONE: Record<PaymentStatus, string> = {
  PENDING: 'warning',
  AUTHORIZED: 'warning',
  SUCCEEDED: 'success',
  PARTIALLY_REFUNDED: 'warning',
  REFUNDED: 'neutral',
  FAILED: 'danger',
  CANCELLED: 'neutral',
  DISPUTED: 'danger',
  SETTLED_OFFLINE: 'success',
};

const ATTEMPT_TONE: Record<PaymentAttemptStatus, string> = {
  PENDING: 'warning',
  SUCCEEDED: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};

const CASH_TONE: Record<CashSettlementStatus, string> = {
  AWAITING_CONFIRMATION: 'warning',
  CUSTOMER_CONFIRMED: 'warning',
  PROVIDER_CONFIRMED: 'warning',
  CONFIRMED: 'success',
  DISPUTED: 'danger',
  RESOLVED_UNPAID: 'neutral',
};

const PAYOUT_TONE: Record<PayoutStatus, string> = {
  REQUESTED: 'warning',
  APPROVED: 'warning',
  PROCESSING: 'warning',
  PAID: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};

const EARNING_TONE: Record<ProviderEarningStatus, string> = {
  PENDING: 'warning',
  HELD: 'danger',
  AVAILABLE: 'success',
  REVERSED: 'neutral',
};

const REFUND_TONE: Record<RefundStatus, string> = {
  REQUESTED: 'warning',
  SUCCEEDED: 'success',
  FAILED: 'danger',
};

export function PaymentStatusPill({ status }: { status: PaymentStatus }) {
  return (
    <span className={`pill pill-${PAYMENT_TONE[status]}`}>{PAYMENT_STATUS_LABELS[status]}</span>
  );
}

export function AttemptStatusPill({ status }: { status: PaymentAttemptStatus }) {
  return (
    <span className={`pill pill-${ATTEMPT_TONE[status]}`}>{ATTEMPT_STATUS_LABELS[status]}</span>
  );
}

export function CashStatusPill({ status }: { status: CashSettlementStatus }) {
  return <span className={`pill pill-${CASH_TONE[status]}`}>{CASH_STATUS_LABELS[status]}</span>;
}

export function PayoutStatusPill({ status }: { status: PayoutStatus }) {
  return <span className={`pill pill-${PAYOUT_TONE[status]}`}>{PAYOUT_STATUS_LABELS[status]}</span>;
}

export function EarningStatusPill({ status }: { status: ProviderEarningStatus }) {
  return (
    <span className={`pill pill-${EARNING_TONE[status]}`}>{EARNING_STATUS_LABELS[status]}</span>
  );
}

export function RefundStatusPill({ status }: { status: RefundStatus }) {
  return <span className={`pill pill-${REFUND_TONE[status]}`}>{REFUND_STATUS_LABELS[status]}</span>;
}
