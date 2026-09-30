import type {
  JobStatus,
  OnboardingStep,
  ProviderStatus,
  QuoteRevisionKind,
  QuoteStatus,
  ServiceRequestStatus,
  ServiceRequestType,
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

export const REQUEST_STATUS_LABELS: Record<ServiceRequestStatus, string> = {
  DRAFT: 'Taslak',
  PUBLISHED: 'Açık',
  MATCHING: 'Usta aranıyor',
  QUOTED: 'Teklif geldi',
  MATCHED: 'Anlaşıldı',
  CANCELLED: 'İptal edildi',
  EXPIRED: 'Süresi doldu',
  COMPLETED: 'Tamamlandı',
};

export const REQUEST_TYPE_LABELS: Record<ServiceRequestType, string> = {
  NOW: 'ACİL (NOW)',
  QUOTE: 'Teklif',
};

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  PENDING_CUSTOMER: 'Müşteri yanıtı bekleniyor',
  PENDING_PROVIDER: 'Usta yanıtı bekleniyor',
  ACCEPTED: 'Kabul edildi',
  REJECTED: 'Reddedildi',
  WITHDRAWN: 'Geri çekildi',
  EXPIRED: 'Süresi doldu',
};

export const REVISION_KIND_LABELS: Record<QuoteRevisionKind, string> = {
  OFFER: 'Usta teklifi',
  CUSTOMER_COUNTER: 'Müşteri karşı teklifi',
  PROVIDER_COUNTER: 'Usta karşı teklifi',
};

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  CREATED: 'Oluşturuldu',
  CONFIRMED: 'Onaylandı',
  PROVIDER_PREPARING: 'Usta hazırlanıyor',
  PROVIDER_EN_ROUTE: 'Usta yolda',
  PROVIDER_ARRIVED: 'Usta adreste',
  IN_PROGRESS: 'Devam ediyor',
  AWAITING_COMPLETION_CONFIRMATION: 'Tamamlanma onayı bekleniyor',
  COMPLETED: 'Tamamlandı',
  DISPUTED: 'Anlaşmazlık',
  CANCELLED: 'İptal edildi',
};
