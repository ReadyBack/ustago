/**
 * Faz 6 trust and safety types: provider account verification, account
 * status and suspensions, admin permissions, sessions and risk signals
 * (docs/adr/0023, docs/adr/0024).
 */
import type { NamedRef } from './address.js';
import type { AuditEvent } from './audit.js';
import type { ProviderStatus } from './auth.js';
import type { WalletBalances } from './finance.js';
import type { Money } from './money.js';
import type { ProviderVerification, VerificationType } from './provider.js';

export type ProviderVerificationStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'NEEDS_REVISION'
  | 'VERIFIED'
  | 'REJECTED'
  | 'SUSPENDED';

export type ProviderAccountStatus = 'ACTIVE' | 'LIMITED' | 'SUSPENDED' | 'BANNED';

export type DocumentScanStatus = 'NOT_SCANNED' | 'SAFE' | 'REJECTED' | 'QUARANTINED';

/** What the provider may do right now, from the central eligibility policy. */
export interface ProviderCapabilities {
  /** Shown in search and on public profiles. */
  listed: boolean;
  canQuote: boolean;
  canTakeNowJobs: boolean;
  canRequestPayout: boolean;
  showVerifiedBadge: boolean;
  /** Human-readable reasons for each missing capability (Turkish). */
  restrictions: string[];
}

/** One step of the "Hesabımı Doğrula" checklist. */
export interface VerificationChecklistItem {
  key: 'PROFILE' | 'SERVICES' | 'SERVICE_AREAS' | 'DOCUMENTS' | 'SUBMIT';
  label: string;
  done: boolean;
}

/** A document the case needs, and the one currently on file for it. */
export interface VerificationDocumentRequirement {
  type: VerificationType;
  required: boolean;
  /** Why it is asked for (category rule or the platform default). */
  reason: string;
  current: ProviderVerification | null;
}

/** GET /providers/me/verification: the provider's own verification case. */
export interface ProviderVerificationCaseView {
  status: ProviderVerificationStatus;
  providerStatus: ProviderStatus;
  accountStatus: ProviderAccountStatus;
  method: 'MANUAL';
  submittedAt: string | null;
  submissionCount: number;
  decidedAt: string | null;
  verifiedAt: string | null;
  /** Explanation written for the provider on revision or rejection. */
  userVisibleReason: string | null;
  reasonCode: string | null;
  checklist: VerificationChecklistItem[];
  documents: VerificationDocumentRequirement[];
  canSubmit: boolean;
  canEditDocuments: boolean;
  capabilities: ProviderCapabilities;
  activeSuspension: ProviderSuspensionView | null;
  timeline: VerificationTimelineEntry[];
}

export interface VerificationTimelineEntry {
  id: string;
  event: string;
  fromStatus: ProviderVerificationStatus | null;
  toStatus: ProviderVerificationStatus;
  actorType: 'PROVIDER' | 'ADMIN' | 'SYSTEM';
  /** Provider-visible explanation; internal notes never appear here. */
  userVisibleReason: string | null;
  createdAt: string;
}

export type SuspensionStatus = 'ACTIVE' | 'LIFTED' | 'EXPIRED' | 'EXPIRED_PENDING_REVIEW';

/** The provider's view of a suspension: no internal note. */
export interface ProviderSuspensionView {
  id: string;
  level: 'SUSPENDED' | 'BANNED' | 'LIMITED';
  status: SuspensionStatus;
  reasonCode: string;
  userVisibleReason: string;
  startsAt: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface AdminSuspension extends ProviderSuspensionView {
  providerId: string;
  internalNote: string | null;
  autoLift: boolean;
  createdBy: NamedRef | null;
  liftedBy: NamedRef | null;
  liftedAt: string | null;
  liftNote: string | null;
}

/** Row of the admin "Doğrulama Talepleri" queue. */
export interface AdminVerificationCaseListItem {
  providerId: string;
  displayName: string;
  contactName: string;
  status: ProviderVerificationStatus;
  providerStatus: ProviderStatus;
  accountStatus: ProviderAccountStatus;
  submittedAt: string | null;
  submissionCount: number;
  documentCount: number;
  reviewedBy: NamedRef | null;
  updatedAt: string;
}

export interface AdminVerificationEvent extends VerificationTimelineEntry {
  actor: NamedRef | null;
  reasonCode: string | null;
  internalNote: string | null;
}

export interface AdminVerificationDocument extends ProviderVerification {
  sha256: string | null;
  scanStatus: DocumentScanStatus;
  /** Another provider uploaded a file with the same hash. */
  duplicateOfOtherProvider: boolean;
}

export interface AdminVerificationCaseDetail {
  providerId: string;
  userId: string;
  displayName: string;
  contact: { firstName: string; lastName: string; phoneMasked: string | null };
  status: ProviderVerificationStatus;
  providerStatus: ProviderStatus;
  accountStatus: ProviderAccountStatus;
  method: 'MANUAL';
  source: string;
  submittedAt: string | null;
  submissionCount: number;
  reviewStartedAt: string | null;
  reviewedBy: NamedRef | null;
  decidedAt: string | null;
  decisionBy: NamedRef | null;
  decisionReasonCode: string | null;
  userVisibleReason: string | null;
  internalNote: string | null;
  verifiedAt: string | null;
  version: number;
  categories: string[];
  areas: string[];
  checklist: VerificationChecklistItem[];
  documents: AdminVerificationDocument[];
  requiredDocumentTypes: VerificationType[];
  timeline: AdminVerificationEvent[];
  actions: {
    startReview: boolean;
    approve: boolean;
    requestRevision: boolean;
    reject: boolean;
  };
}

export type AdminPermission =
  'ADMIN_SUPPORT' | 'ADMIN_VERIFICATION' | 'ADMIN_FINANCE' | 'ADMIN_SUPER';

export interface AdminUserPermissions {
  userId: string;
  name: string;
  email: string | null;
  roles: string[];
  permissions: AdminPermission[];
  /** Effective set, including everything SUPER implies. */
  effective: AdminPermission[];
}

/** One signed-in device ("Aktif Oturumlar"). No raw IP is ever stored. */
export interface ActiveSession {
  id: string;
  current: boolean;
  deviceName: string | null;
  platform: 'IOS' | 'ANDROID' | 'WEB' | null;
  userAgentSummary: string | null;
  /** Rounded to the hour: an approximate sign-in time. */
  createdApprox: string;
  lastUsedAt: string;
  expiresAt: string;
}

export type RiskSignalType =
  | 'OTP_ABUSE'
  | 'QUOTE_SPAM'
  | 'CANCEL_ABUSE'
  | 'PAYMENT_ABUSE'
  | 'REVIEW_ABUSE'
  | 'DEVICE_ANOMALY'
  | 'ADMIN_FLAG';

export type RiskSignalStatus = 'OPEN' | 'REVIEWED' | 'DISMISSED';

/** Evidence for a human; never an automatic decision. */
export interface RiskSignal {
  id: string;
  type: RiskSignalType;
  status: RiskSignalStatus;
  subject: NamedRef | null;
  evidence: Record<string, unknown>;
  source: string;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  reviewedBy: NamedRef | null;
  reviewNote: string | null;
}

export type AccountDeletionStatus =
  'REQUESTED' | 'BLOCKED_BY_ACTIVE_JOB' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED';

export interface AccountDeletionRequestView {
  id: string;
  status: AccountDeletionStatus;
  blockers: string[];
  requestedAt: string;
  scheduledFor: string | null;
  completedAt: string | null;
}

/** A document a category requires before a provider may quote in it. */
export interface CategoryRequirement {
  id: string;
  categoryId: string;
  categoryName: string;
  documentType: VerificationType;
  note: string | null;
  createdAt: string;
}

/**
 * GET /admin/providers/:id/360: everything support needs about one
 * provider on one screen. Loaded with a fixed number of queries.
 */
export interface AdminProvider360 {
  providerId: string;
  userId: string;
  displayName: string;
  applicationStatus: ProviderStatus;
  accountStatus: ProviderAccountStatus;
  verificationStatus: ProviderVerificationStatus;
  capabilities: ProviderCapabilities;
  createdAt: string;
  contact: { name: string; phone: string | null; email: string | null };
  suspensions: AdminSuspension[];
  jobs: {
    total: number;
    byStatus: Record<string, number>;
    recent: { id: string; status: string; currentTotal: Money; createdAt: string }[];
  };
  reviews: {
    published: number;
    hidden: number;
    average: number | null;
    recent: {
      id: string;
      rating: number;
      comment: string | null;
      status: string;
      createdAt: string;
    }[];
  };
  quality: {
    ustaScore: number | null;
    sampleSize: number;
    isNewProvider: boolean;
    computedAt: string | null;
  };
  finance: {
    /** Ledger-derived; there is no stored balance to edit. */
    balances: WalletBalances;
    earningsByStatus: Record<string, Money>;
    recentPayouts: { id: string; status: string; amount: Money; createdAt: string }[];
    destination: {
      maskedIban: string;
      isTest: boolean;
      verificationStatus: 'UNVERIFIED' | 'PENDING_VERIFICATION' | 'VERIFIED';
    } | null;
  };
  penalties: {
    id: string;
    type: string;
    status: string;
    reasonCode: string;
    startsAt: string;
    endsAt: string | null;
  }[];
  audit: AuditEvent[];
}

/**
 * A recorded personal-data export request. Building the archive is not
 * implemented yet (docs/adr/0027): the request is kept and handled
 * manually until the export job exists.
 */
export interface DataExportRequestView {
  id: string;
  status: 'REQUESTED' | 'PROCESSING' | 'READY' | 'EXPIRED' | 'FAILED';
  requestedAt: string;
  readyAt: string | null;
}
