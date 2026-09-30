import type { NamedRef } from './address.js';
import type {
  ApproximateLocation,
  CategoryRef,
  JobStatus,
  QuoteRevision,
  ServiceRequestType,
} from './marketplace.js';
import type { Money } from './money.js';

/**
 * Job lifecycle, change orders, disputes, reviews, provider quality and
 * notifications (Faz 4, docs/adr/0015-0017).
 */

/** Who performed an action on a job. */
export type JobActor = 'CUSTOMER' | 'PROVIDER' | 'ADMIN' | 'SYSTEM';

/** Steps of the timeline both parties see, in order. */
export type JobStep =
  'AGREED' | 'EN_ROUTE' | 'ARRIVED' | 'STARTED' | 'COMPLETION_REQUESTED' | 'COMPLETED';

/** One timeline step; `at` is the real time it happened, null until then. */
export interface JobTimelineEntry {
  step: JobStep;
  at: string | null;
}

export type ChangeOrderStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';

/** Extra work the provider asks for during a job ("Ek iş"). */
export interface ChangeOrder {
  id: string;
  jobId: string;
  status: ChangeOrderStatus;
  /** Always positive: the extra amount. */
  amount: Money;
  description: string;
  /** Job total when proposed and the total if accepted. */
  previousTotal: Money;
  proposedTotal: Money;
  createdAt: string;
  respondedAt: string | null;
}

export type DisputeReason =
  | 'NO_SHOW'
  | 'POOR_QUALITY'
  | 'PRICE_DISAGREEMENT'
  | 'PAYMENT_ISSUE'
  | 'DAMAGE'
  | 'MISCONDUCT'
  | 'OTHER';

export type DisputeStatus =
  | 'OPEN'
  | 'AWAITING_EVIDENCE'
  | 'UNDER_REVIEW'
  | 'RESOLVED_FOR_CUSTOMER'
  | 'RESOLVED_FOR_PROVIDER'
  | 'RESOLVED_PARTIAL'
  | 'CLOSED';

/** A dispute as the two parties of the job see it. */
export interface JobDispute {
  id: string;
  status: DisputeStatus;
  reason: DisputeReason;
  description: string;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export type ReviewStatus = 'PUBLISHED' | 'UNDER_MODERATION' | 'HIDDEN';

/** The customer's own review of a job. */
export interface Review {
  id: string;
  jobId: string;
  status: ReviewStatus;
  /** 1-5, required. */
  rating: number;
  qualityRating: number | null;
  communicationRating: number | null;
  punctualityRating: number | null;
  /** "Fiyat / Performans". */
  valueRating: number | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  /** The author may edit until then. */
  editableUntil: string;
}

/** What the caller may do on a job right now; the server enforces the same rules. */
export interface JobActions {
  enRoute: boolean;
  arrive: boolean;
  start: boolean;
  addChangeOrder: boolean;
  requestCompletion: boolean;
  complete: boolean;
  dispute: boolean;
  cancel: boolean;
  review: boolean;
  editReview: boolean;
}

/** A review on a public profile. No address, phone, e-mail or job id. */
export interface PublicReview {
  id: string;
  rating: number;
  qualityRating: number | null;
  communicationRating: number | null;
  punctualityRating: number | null;
  valueRating: number | null;
  comment: string | null;
  /** Masked, e.g. "Ayşe D.". */
  authorName: string;
  categoryName: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Provider quality (UstaScore V1)
// ---------------------------------------------------------------------------

export type QualityFactorKey =
  | 'REVIEWS'
  | 'COMPLETION'
  | 'CANCELLATION'
  | 'DISPUTES'
  | 'RESPONSE'
  | 'VERIFICATION'
  | 'EXPERIENCE';

/** One UstaScore input. `score` is 0-100, null when there is no reliable data. */
export interface QualityFactor {
  key: QualityFactorKey;
  /** Nominal weight (0-1). */
  weight: number;
  /** Weight after renormalising over the available factors. */
  effectiveWeight: number;
  score: number | null;
  /** How the score was derived, for admins and appeals. */
  detail: string;
}

export type DisciplinaryActionType =
  | 'WARNING'
  | 'VISIBILITY_REDUCTION'
  | 'NOW_SUSPENSION'
  | 'JOB_RESTRICTION'
  | 'TEMPORARY_SUSPENSION'
  | 'PERMANENT_BAN';

export type DisciplinaryActionStatus = 'ACTIVE' | 'UNDER_APPEAL' | 'REVOKED' | 'EXPIRED';

export type PenaltySeverity = 'WARNING' | 'MINOR' | 'MAJOR' | 'CRITICAL';

/** A sanction decided by an admin (never automatic). */
export interface ProviderPenalty {
  id: string;
  type: DisciplinaryActionType;
  severity: PenaltySeverity;
  status: DisciplinaryActionStatus;
  reasonCode: string;
  reason: string;
  disputeId: string | null;
  startsAt: string;
  endsAt: string | null;
  decidedBy: NamedRef | null;
  createdAt: string;
}

/** Admin view of a provider's quality and the UstaScore breakdown. */
export interface ProviderQuality {
  providerId: string;
  completedJobs: number;
  /** Cancelled by the provider after agreement. */
  providerCancelledJobs: number;
  /** Cancelled by the customer; never held against the provider. */
  customerCancelledJobs: number;
  openDisputes: number;
  reviewCount: number;
  ratingAverage: number | null;
  ustaScore: number | null;
  isNewProvider: boolean;
  algorithmVersion: string | null;
  computedAt: string | null;
  factors: QualityFactor[];
  /** Points taken off by active penalties. */
  penaltyPoints: number;
  penalties: ProviderPenalty[];
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface NotificationPreferences {
  /** Always true: job updates are transactional (someone is coming to the door). */
  jobUpdatesPush: true;
  quoteUpdatesPush: boolean;
  marketingPush: boolean;
}

export interface UnreadNotificationCount {
  unread: number;
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export interface AdminJobListItem {
  id: string;
  status: JobStatus;
  requestType: ServiceRequestType;
  title: string;
  category: CategoryRef;
  location: ApproximateLocation;
  customer: { id: string; name: string };
  provider: { id: string; displayName: string };
  agreedPrice: Money;
  currentTotal: Money;
  createdAt: string;
}

export interface JobStatusChange {
  from: JobStatus | null;
  to: JobStatus;
  actor: JobActor | null;
  reason: string | null;
  at: string;
}

export interface AdminAuditLine {
  action: string;
  entityType: string | null;
  at: string;
}

export interface AdminReview {
  id: string;
  status: ReviewStatus;
  rating: number;
  qualityRating: number | null;
  communicationRating: number | null;
  punctualityRating: number | null;
  valueRating: number | null;
  comment: string | null;
  jobId: string;
  provider: { id: string; displayName: string };
  /** Masked. */
  customerName: string;
  createdAt: string;
  updatedAt: string;
  moderatedAt: string | null;
  moderationReason: string | null;
}

export interface AdminDisputeListItem {
  id: string;
  status: DisputeStatus;
  reason: DisputeReason;
  job: { id: string; title: string; status: JobStatus };
  customer: { id: string; name: string };
  provider: { id: string; displayName: string };
  createdAt: string;
  resolvedAt: string | null;
}

export interface AdminDisputeDetail extends AdminDisputeListItem {
  description: string;
  resolution: string | null;
  resolvedBy: NamedRef | null;
  timeline: JobTimelineEntry[];
}

export interface AdminJobDetail extends AdminJobListItem {
  serviceRequest: {
    id: string;
    title: string;
    description: string;
    budget: Money | null;
  };
  location: ApproximateLocation & { neighborhood: string | null };
  customer: { id: string; name: string; maskedPhone: string | null };
  /** The accepted negotiation, oldest move first. */
  negotiation: QuoteRevision[];
  acceptedRevisionId: string | null;
  timeline: JobTimelineEntry[];
  statusHistory: JobStatusChange[];
  changeOrders: ChangeOrder[];
  review: AdminReview | null;
  disputes: AdminDisputeListItem[];
  cancellation: { at: string; actor: JobActor | null; reason: string | null } | null;
  audit: AdminAuditLine[];
}
