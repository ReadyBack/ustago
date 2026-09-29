import type { ProviderOnboardingStatus } from '@ustago/types';

import type {
  ProviderStatus,
  VerificationStatus,
  VerificationType,
} from '../../generated/prisma/client.js';

/**
 * Verification types every provider needs before submitting. Category-
 * specific requirements (e.g. an electrician certificate) can extend this
 * list later without changing the flow.
 */
export const REQUIRED_VERIFICATION_TYPES: readonly VerificationType[] = ['IDENTITY'];

/** A short introduction customers read; one sentence is enough. */
export const MIN_BIO_LENGTH = 20;

export interface OnboardingSnapshot {
  status: ProviderStatus;
  statusReason: string | null;
  phoneVerified: boolean;
  displayName: string;
  bio: string | null;
  yearsOfExperience: number | null;
  /** Services whose category is active. */
  activeServiceCount: number;
  /** Service-area districts that are active. */
  activeAreaCount: number;
  verifications: readonly { type: VerificationType; status: VerificationStatus }[];
}

export function isProfileComplete(
  s: Pick<OnboardingSnapshot, 'displayName' | 'bio' | 'yearsOfExperience'>,
): boolean {
  return (
    s.displayName.trim().length >= 2 &&
    (s.bio?.trim().length ?? 0) >= MIN_BIO_LENGTH &&
    s.yearsOfExperience !== null
  );
}

/** Required types without a submission that is pending or approved. */
export function missingSubmissions(
  verifications: OnboardingSnapshot['verifications'],
): VerificationType[] {
  return REQUIRED_VERIFICATION_TYPES.filter(
    (type) =>
      !verifications.some(
        (v) => v.type === type && (v.status === 'PENDING' || v.status === 'APPROVED'),
      ),
  );
}

/** Required types not yet approved by an admin (blocks provider approval). */
export function missingApprovals(
  verifications: OnboardingSnapshot['verifications'],
): VerificationType[] {
  return REQUIRED_VERIFICATION_TYPES.filter(
    (type) => !verifications.some((v) => v.type === type && v.status === 'APPROVED'),
  );
}

export function computeOnboarding(s: OnboardingSnapshot): ProviderOnboardingStatus {
  const steps = {
    PHONE_VERIFIED: s.phoneVerified,
    PROFILE: isProfileComplete(s),
    SERVICES: s.activeServiceCount > 0,
    SERVICE_AREAS: s.activeAreaCount > 0,
    REQUIRED_VERIFICATIONS: missingSubmissions(s.verifications).length === 0,
  } as const;
  const missingSteps = (Object.keys(steps) as (keyof typeof steps)[]).filter((k) => !steps[k]);
  const totalSteps = Object.keys(steps).length;
  return {
    providerStatus: s.status,
    phoneVerified: steps.PHONE_VERIFIED,
    profileComplete: steps.PROFILE,
    servicesComplete: steps.SERVICES,
    serviceAreasComplete: steps.SERVICE_AREAS,
    requiredVerificationsComplete: steps.REQUIRED_VERIFICATIONS,
    requiredVerificationTypes: [...REQUIRED_VERIFICATION_TYPES],
    missingSteps,
    completedSteps: totalSteps - missingSteps.length,
    totalSteps,
    canSubmit: missingSteps.length === 0 && s.status === 'DRAFT',
    statusReason: s.status === 'REJECTED' || s.status === 'SUSPENDED' ? s.statusReason : null,
  };
}
