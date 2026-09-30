import type { DisputeStatus, JobStatus, ReviewStatus } from '@ustago/types';

import { DISPUTE_STATUS_LABELS, JOB_STATUS_LABELS, REVIEW_STATUS_LABELS } from '@/lib/labels';

const JOB_TONE: Record<JobStatus, string> = {
  CREATED: 'neutral',
  CONFIRMED: 'neutral',
  PROVIDER_PREPARING: 'warning',
  PROVIDER_EN_ROUTE: 'warning',
  PROVIDER_ARRIVED: 'warning',
  IN_PROGRESS: 'warning',
  AWAITING_COMPLETION_CONFIRMATION: 'warning',
  COMPLETED: 'success',
  DISPUTED: 'danger',
  CANCELLED: 'neutral',
};

const DISPUTE_TONE: Record<DisputeStatus, string> = {
  OPEN: 'danger',
  AWAITING_EVIDENCE: 'warning',
  UNDER_REVIEW: 'warning',
  RESOLVED_FOR_CUSTOMER: 'success',
  RESOLVED_FOR_PROVIDER: 'success',
  RESOLVED_PARTIAL: 'success',
  CLOSED: 'neutral',
};

const REVIEW_TONE: Record<ReviewStatus, string> = {
  PUBLISHED: 'success',
  UNDER_MODERATION: 'warning',
  HIDDEN: 'danger',
};

export function JobStatusPill({ status }: { status: JobStatus }) {
  return <span className={`pill pill-${JOB_TONE[status]}`}>{JOB_STATUS_LABELS[status]}</span>;
}

export function DisputeStatusPill({ status }: { status: DisputeStatus }) {
  return (
    <span className={`pill pill-${DISPUTE_TONE[status]}`}>{DISPUTE_STATUS_LABELS[status]}</span>
  );
}

export function ReviewStatusPill({ status }: { status: ReviewStatus }) {
  return <span className={`pill pill-${REVIEW_TONE[status]}`}>{REVIEW_STATUS_LABELS[status]}</span>;
}

/** "★★★★☆ 4/5" for tables; the number is what screen readers get. */
export function RatingText({ value }: { value: number }) {
  return (
    <span aria-label={`5 üzerinden ${value} yıldız`}>
      <span aria-hidden="true" style={{ color: '#F5A524' }}>
        {'★'.repeat(value)}
        {'☆'.repeat(5 - value)}
      </span>{' '}
      {value}/5
    </span>
  );
}
