import type { QuoteStatus, ServiceRequestStatus, ServiceRequestType } from '@ustago/types';

import { QUOTE_STATUS_LABELS, REQUEST_STATUS_LABELS, REQUEST_TYPE_LABELS } from '@/lib/labels';

const REQUEST_TONE: Record<ServiceRequestStatus, string> = {
  DRAFT: 'neutral',
  PUBLISHED: 'warning',
  MATCHING: 'warning',
  QUOTED: 'warning',
  MATCHED: 'success',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral',
};

const QUOTE_TONE: Record<QuoteStatus, string> = {
  PENDING_CUSTOMER: 'warning',
  PENDING_PROVIDER: 'warning',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  WITHDRAWN: 'neutral',
  EXPIRED: 'neutral',
};

export function RequestStatusPill({ status }: { status: ServiceRequestStatus }) {
  return (
    <span className={`pill pill-${REQUEST_TONE[status]}`}>{REQUEST_STATUS_LABELS[status]}</span>
  );
}

export function RequestTypePill({ type }: { type: ServiceRequestType }) {
  return (
    <span className={`pill ${type === 'NOW' ? 'pill-danger' : 'pill-neutral'}`}>
      {type === 'NOW' ? '🚨 ' : ''}
      {REQUEST_TYPE_LABELS[type]}
    </span>
  );
}

export function QuoteStatusPill({ status }: { status: QuoteStatus }) {
  return <span className={`pill pill-${QUOTE_TONE[status]}`}>{QUOTE_STATUS_LABELS[status]}</span>;
}
