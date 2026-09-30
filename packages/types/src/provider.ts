import type { NamedRef } from './address.js';
import type { ProviderStatus, ProviderType } from './auth.js';
import type { ProviderRating } from './marketplace.js';

export type VerificationType =
  | 'IDENTITY'
  | 'PROFESSIONAL_CERTIFICATE'
  | 'TAX_REGISTRATION'
  | 'BUSINESS_LICENSE'
  | 'CRIMINAL_RECORD'
  | 'BUSINESS_DOCUMENT'
  | 'OTHER';

export type VerificationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

/** A category the provider works in. */
export interface ProviderServiceItem {
  categoryId: string;
  slug: string;
  name: string;
  supportsNow: boolean;
  supportsQuote: boolean;
}

/** Districts the provider serves, grouped by province. */
export interface ProviderServiceAreaGroup {
  province: NamedRef<number>;
  districts: NamedRef[];
}

export type OnboardingStep =
  'PHONE_VERIFIED' | 'PROFILE' | 'SERVICES' | 'SERVICE_AREAS' | 'REQUIRED_VERIFICATIONS';

/** GET /providers/me/onboarding: what is done and what is left. */
export interface ProviderOnboardingStatus {
  providerStatus: ProviderStatus;
  phoneVerified: boolean;
  profileComplete: boolean;
  servicesComplete: boolean;
  serviceAreasComplete: boolean;
  requiredVerificationsComplete: boolean;
  /** Verification types that must be submitted (PENDING or APPROVED). */
  requiredVerificationTypes: VerificationType[];
  missingSteps: OnboardingStep[];
  completedSteps: number;
  totalSteps: number;
  /** True when every step is done and the status allows submitting. */
  canSubmit: boolean;
  /** Reason shown while REJECTED or SUSPENDED. */
  statusReason: string | null;
}

/** The provider's own view of a verification. Never contains storage keys. */
export interface ProviderVerification {
  id: string;
  type: VerificationType;
  status: VerificationStatus;
  mimeType: string | null;
  sizeBytes: number | null;
  originalFileName: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
}

/** POST /providers/me/verifications/upload-intent */
export interface UploadIntentResponse {
  uploadId: string;
  /** Send the file body here with `method` and exactly `headers`. */
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  maxSizeBytes: number;
  expiresAt: string;
}

/** A short-lived signed URL for a private document. */
export interface SignedUrl {
  url: string;
  expiresAt: string;
}

/**
 * Customer-facing provider profile. Contains no contact details, documents,
 * identity data or admin notes (PROJECT.md §21, KVKK data minimisation).
 */
export interface PublicProviderProfile {
  id: string;
  displayName: string;
  type: ProviderType;
  bio: string | null;
  yearsOfExperience: number | null;
  services: ProviderServiceItem[];
  serviceAreas: ProviderServiceAreaGroup[];
  /** Approved verification types, shown as badges. */
  verificationBadges: VerificationType[];
  /**
   * True only while the provider's account verification case is VERIFIED
   * and the account is not suspended (docs/adr/0023). Shown as
   * "Kimliği/hesabı doğrulanmıştır"; it is not a quality guarantee.
   */
  isVerified: boolean;
  /** Average of published customer reviews; null until the first one. */
  rating: ProviderRating | null;
  completedJobCount: number;
  /**
   * UstaScore V1 (0-100, docs/adr/0016). Null while the provider is new or
   * has not been scored yet: the app then shows "Yeni Usta".
   */
  ustaScore: number | null;
  isNewProvider: boolean;
  memberSince: string;
}

/** Admin review queue row. */
export interface AdminProviderListItem {
  id: string;
  userId: string;
  displayName: string;
  type: ProviderType;
  status: ProviderStatus;
  submittedAt: string | null;
  createdAt: string;
  contactName: string;
  pendingVerifications: number;
}

/** Admin view of a verification, including who reviewed it. */
export interface AdminProviderVerification extends ProviderVerification {
  providerId: string;
  reviewedBy: NamedRef | null;
  hasDocument: boolean;
}

export interface AdminProviderDetail {
  id: string;
  userId: string;
  displayName: string;
  type: ProviderType;
  status: ProviderStatus;
  statusReason: string | null;
  bio: string | null;
  yearsOfExperience: number | null;
  nowEnabled: boolean;
  isAvailableNow: boolean;
  submittedAt: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  contact: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    phoneVerifiedAt: string | null;
  };
  services: ProviderServiceItem[];
  serviceAreas: ProviderServiceAreaGroup[];
  verifications: AdminProviderVerification[];
  onboarding: ProviderOnboardingStatus;
}
