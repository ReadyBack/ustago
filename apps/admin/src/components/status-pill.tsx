import type { ProviderStatus, VerificationStatus } from '@ustago/types';

import { PROVIDER_STATUS_LABELS, VERIFICATION_STATUS_LABELS } from '@/lib/labels';

const TONE: Record<ProviderStatus | VerificationStatus, string> = {
  DRAFT: 'neutral',
  PENDING_REVIEW: 'warning',
  PENDING: 'warning',
  ACTIVE: 'success',
  APPROVED: 'success',
  REJECTED: 'danger',
  SUSPENDED: 'danger',
  EXPIRED: 'neutral',
};

export function ProviderStatusPill({ status }: { status: ProviderStatus }) {
  return <span className={`pill pill-${TONE[status]}`}>{PROVIDER_STATUS_LABELS[status]}</span>;
}

export function VerificationStatusPill({ status }: { status: VerificationStatus }) {
  return <span className={`pill pill-${TONE[status]}`}>{VERIFICATION_STATUS_LABELS[status]}</span>;
}
