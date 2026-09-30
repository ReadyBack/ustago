import type { ProviderRating } from '@ustago/types';
import { REVIEW_EDIT_WINDOW_DAYS } from '@ustago/validation';

import type { JobStatus, ReviewStatus } from '../../generated/prisma/client.js';

/**
 * Review rules (docs/adr/0016). A review exists only for a real, completed
 * job and only its customer writes it: that is what keeps fake reviews
 * out. One review per job is enforced by a unique index.
 */

export type ReviewEligibility =
  | { ok: true }
  | { ok: false; reason: 'NOT_CUSTOMER' | 'JOB_NOT_COMPLETED' };

export function reviewEligibility(
  job: { status: JobStatus; customerUserId: string },
  userId: string,
): ReviewEligibility {
  if (job.customerUserId !== userId) return { ok: false, reason: 'NOT_CUSTOMER' };
  if (job.status !== 'COMPLETED') return { ok: false, reason: 'JOB_NOT_COMPLETED' };
  return { ok: true };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function editableUntil(createdAt: Date): Date {
  return new Date(createdAt.getTime() + REVIEW_EDIT_WINDOW_DAYS * DAY_MS);
}

/** Authors can edit a published review within the window; a hidden one stays as moderated. */
export function isEditable(
  review: { createdAt: Date; status: ReviewStatus },
  now = new Date(),
): boolean {
  return review.status === 'PUBLISHED' && editableUntil(review.createdAt) > now;
}

/** Only published reviews count; hidden ones stay in the database and the audit log. */
export const COUNTED_REVIEW_STATUSES = ['PUBLISHED'] as const satisfies readonly ReviewStatus[];

/**
 * The public "Kullanıcı Puanı": the plain average of published reviews,
 * one decimal. Null with no reviews, so the app shows "Yeni Usta" instead
 * of an invented number.
 */
export function toProviderRating(count: number, average: number | null): ProviderRating | null {
  if (count <= 0 || average === null) return null;
  return { average: Math.round(average * 10) / 10, count };
}
