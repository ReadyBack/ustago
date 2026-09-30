import type { ChangeOrder, JobDispute, Review } from '@ustago/types';

import { toMoney } from '../common/money.js';
import type {
  ChangeOrder as ChangeOrderRow,
  Dispute as DisputeRow,
  Review as ReviewRow,
} from '../generated/prisma/client.js';
import { editableUntil } from '../reviews/domain/review-policy.js';

export function toChangeOrder(c: ChangeOrderRow): ChangeOrder {
  return {
    id: c.id,
    jobId: c.jobId,
    status: c.status,
    amount: toMoney(c.amountDeltaMinor, c.currency),
    description: c.description,
    previousTotal: toMoney(c.previousTotalMinor, c.currency),
    proposedTotal: toMoney(c.proposedTotalMinor, c.currency),
    createdAt: c.createdAt.toISOString(),
    respondedAt: c.respondedAt?.toISOString() ?? null,
  };
}

export function toReview(r: ReviewRow): Review {
  return {
    id: r.id,
    jobId: r.jobId,
    status: r.status,
    rating: r.rating,
    qualityRating: r.qualityRating,
    communicationRating: r.communicationRating,
    punctualityRating: r.punctualityRating,
    valueRating: r.priceRating,
    comment: r.comment,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    editableUntil: editableUntil(r.createdAt).toISOString(),
  };
}

export function toJobDispute(d: DisputeRow): JobDispute {
  return {
    id: d.id,
    status: d.status,
    reason: d.reason,
    description: d.description,
    resolution: d.resolution,
    createdAt: d.createdAt.toISOString(),
    resolvedAt: d.resolvedAt?.toISOString() ?? null,
  };
}

export const OPEN_DISPUTE_STATUSES = ['OPEN', 'AWAITING_EVIDENCE', 'UNDER_REVIEW'] as const;
