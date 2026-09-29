import type {
  OnboardingStep,
  ProviderStatus,
  VerificationStatus,
  VerificationType,
} from '@ustago/types';

export const PROVIDER_STATUS_LABELS: Record<ProviderStatus, string> = {
  DRAFT: 'Taslak',
  PENDING_REVIEW: 'İnceleme bekliyor',
  ACTIVE: 'Aktif',
  REJECTED: 'Reddedildi',
  SUSPENDED: 'Askıya alındı',
};

export const VERIFICATION_TYPE_LABELS: Record<VerificationType, string> = {
  IDENTITY: 'Kimlik',
  PROFESSIONAL_CERTIFICATE: 'Mesleki yeterlilik belgesi',
  BUSINESS_LICENSE: 'İşletme belgesi',
  TAX_REGISTRATION: 'Vergi levhası',
  CRIMINAL_RECORD: 'Adli sicil kaydı',
};

export const VERIFICATION_STATUS_LABELS: Record<VerificationStatus, string> = {
  PENDING: 'Bekliyor',
  APPROVED: 'Onaylandı',
  REJECTED: 'Reddedildi',
  EXPIRED: 'Süresi doldu',
};

export const ONBOARDING_STEP_LABELS: Record<OnboardingStep, string> = {
  PHONE_VERIFIED: 'Telefon doğrulandı',
  PROFILE: 'Profil bilgileri',
  SERVICES: 'Hizmet kategorileri',
  SERVICE_AREAS: 'Hizmet bölgeleri',
  REQUIRED_VERIFICATIONS: 'Zorunlu belgeler',
};

const dateFormat = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Istanbul',
});

export function formatDate(iso: string | null | undefined): string {
  return iso ? dateFormat.format(new Date(iso)) : '—';
}
