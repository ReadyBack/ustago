import type {
  ProviderAccountStatus,
  ProviderStatus,
  ProviderVerificationStatus,
} from '../../generated/prisma/client.js';

/**
 * The central provider policy (Faz 6, docs/adr/0023). Every place that asks
 * "may this provider ...?" uses these functions (the matching SQL mirrors
 * them), so a rule changes in one place.
 *
 * Three independent axes:
 *  - application status (Faz 2 onboarding): DRAFT → PENDING_REVIEW → ACTIVE
 *  - verification status (the Faz 6 case): NOT_STARTED ... VERIFIED
 *  - account status (Faz 6 enforcement): ACTIVE / LIMITED / SUSPENDED / BANNED
 * Faz 4 disciplinary actions (NOW suspension, job restriction) stay a
 * separate, finer-grained layer checked by the matching rules.
 */
export interface ProviderPolicyInput {
  applicationStatus: ProviderStatus;
  verificationStatus: ProviderVerificationStatus;
  accountStatus: ProviderAccountStatus;
}

export interface ProviderPolicy {
  listed: boolean;
  canQuote: boolean;
  canTakeNowJobs: boolean;
  canRequestPayout: boolean;
  showVerifiedBadge: boolean;
  restrictions: string[];
}

export const PAYOUT_NOT_VERIFIED_MESSAGE = 'Hesap doğrulamanız tamamlanmadan para çekemezsiniz.';

const OPEN_ACCOUNT: readonly ProviderAccountStatus[] = ['ACTIVE', 'LIMITED'];

export function providerPolicy(input: ProviderPolicyInput): ProviderPolicy {
  const restrictions: string[] = [];
  const approved = input.applicationStatus === 'ACTIVE';
  const accountOpen = OPEN_ACCOUNT.includes(input.accountStatus);
  const verified = input.verificationStatus === 'VERIFIED';

  if (input.accountStatus === 'SUSPENDED') {
    restrictions.push(
      'Hesabınız askıya alındı: yeni teklif veremez, iş alamaz ve para çekemezsiniz.',
    );
  } else if (input.accountStatus === 'BANNED') {
    restrictions.push('Hesabınız kapatıldı.');
  } else if (input.accountStatus === 'LIMITED') {
    restrictions.push('Hesabınız kısıtlı: acil (NOW) işler kapalı.');
  }
  if (!approved) {
    restrictions.push('Başvurunuz onaylanmadan müşterilere görünmezsiniz.');
  }
  if (!verified && accountOpen) {
    restrictions.push('Hesap doğrulaması tamamlanmadan acil (NOW) iş alamaz ve para çekemezsiniz.');
  }

  const listed = approved && accountOpen;
  return {
    listed,
    canQuote: listed,
    canTakeNowJobs: listed && input.accountStatus === 'ACTIVE' && verified,
    canRequestPayout: verified && accountOpen,
    showVerifiedBadge: verified && accountOpen,
    restrictions,
  };
}

/** Why a payout request is refused, or null when the policy allows it. */
export function payoutRefusal(
  input: ProviderPolicyInput & { destinationVerified: boolean },
): { code: string; message: string } | null {
  if (input.accountStatus === 'SUSPENDED' || input.accountStatus === 'BANNED') {
    return {
      code: 'PROVIDER_SUSPENDED',
      message: 'Hesabınız askıdayken para çekme talebi oluşturamazsınız.',
    };
  }
  if (input.verificationStatus !== 'VERIFIED') {
    return { code: 'PROVIDER_NOT_VERIFIED', message: PAYOUT_NOT_VERIFIED_MESSAGE };
  }
  if (!input.destinationVerified) {
    return {
      code: 'PAYOUT_DESTINATION_NOT_VERIFIED',
      message: 'Banka hesabınız henüz doğrulanmadı. Doğrulandığında para çekebilirsiniz.',
    };
  }
  return null;
}
