import type {
  ChangeOrderStatus,
  DisciplinaryActionStatus,
  DisciplinaryActionType,
  DisputeReason,
  DisputeStatus,
  JobActor,
  JobStatus,
  JobStep,
  LedgerAccountType,
  LedgerTransactionType,
  PaymentAttemptStatus,
  PaymentMethodChoice,
  PenaltySeverity,
  QualityFactorKey,
  ReviewStatus,
  OnboardingStep,
  ProviderStatus,
  QuoteRevisionKind,
  QuoteStatus,
  RefundReason,
  RefundStatus,
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
  DISPUTED: 'Sorun bildirildi',
  CANCELLED: 'İptal edildi',
};

export const JOB_ACTOR_LABELS: Record<JobActor, string> = {
  CUSTOMER: 'Müşteri',
  PROVIDER: 'Usta',
  ADMIN: 'Yönetici',
  SYSTEM: 'Sistem',
};

export const JOB_STEP_LABELS: Record<JobStep, string> = {
  AGREED: 'Anlaşma',
  EN_ROUTE: 'Yola çıktı',
  ARRIVED: 'Adrese ulaştı',
  STARTED: 'İşe başladı',
  COMPLETION_REQUESTED: 'Usta tamamladı',
  COMPLETED: 'Müşteri onayladı',
};

export const CHANGE_ORDER_STATUS_LABELS: Record<ChangeOrderStatus, string> = {
  PENDING: 'Onay bekliyor',
  ACCEPTED: 'Onaylandı',
  REJECTED: 'Reddedildi',
  CANCELLED: 'Geri çekildi',
  EXPIRED: 'Sonuçlanmadan kapandı',
};

export const DISPUTE_REASON_LABELS: Record<DisputeReason, string> = {
  NO_SHOW: 'Usta gelmedi',
  POOR_QUALITY: 'İş kalitesi',
  PRICE_DISAGREEMENT: 'Fiyat anlaşmazlığı',
  PAYMENT_ISSUE: 'Ödeme sorunu',
  DAMAGE: 'Hasar',
  MISCONDUCT: 'Uygunsuz davranış',
  OTHER: 'Diğer',
};

export const DISPUTE_STATUS_LABELS: Record<DisputeStatus, string> = {
  OPEN: 'Açık',
  AWAITING_EVIDENCE: 'Kanıt bekleniyor',
  UNDER_REVIEW: 'İnceleniyor',
  RESOLVED_FOR_CUSTOMER: 'Müşteri lehine',
  RESOLVED_FOR_PROVIDER: 'Usta lehine',
  RESOLVED_PARTIAL: 'Kısmen haklı',
  CLOSED: 'Kapatıldı',
};

/** The outcomes an admin can pick when resolving. */
export const DISPUTE_OUTCOMES = [
  'RESOLVED_FOR_CUSTOMER',
  'RESOLVED_FOR_PROVIDER',
  'RESOLVED_PARTIAL',
  'CLOSED',
] as const satisfies readonly DisputeStatus[];

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  PUBLISHED: 'Yayında',
  UNDER_MODERATION: 'İnceleniyor',
  HIDDEN: 'Gizlendi',
};

export const PENALTY_TYPE_LABELS: Record<DisciplinaryActionType, string> = {
  WARNING: 'Uyarı',
  VISIBILITY_REDUCTION: 'Sıralamada geri düşürme',
  NOW_SUSPENSION: 'Acil işlerden uzaklaştırma',
  JOB_RESTRICTION: 'Yeni iş kısıtlaması',
  TEMPORARY_SUSPENSION: 'Geçici askıya alma',
  PERMANENT_BAN: 'Kalıcı kapatma',
};

/** Created from the quality card; account suspension stays in the provider review flow. */
export const PENALTY_TYPES = [
  'WARNING',
  'VISIBILITY_REDUCTION',
  'NOW_SUSPENSION',
  'JOB_RESTRICTION',
] as const satisfies readonly DisciplinaryActionType[];

export const PENALTY_STATUS_LABELS: Record<DisciplinaryActionStatus, string> = {
  ACTIVE: 'Yürürlükte',
  UNDER_APPEAL: 'İtirazda',
  REVOKED: 'Kaldırıldı',
  EXPIRED: 'Süresi doldu',
};

export const PENALTY_SEVERITY_LABELS: Record<PenaltySeverity, string> = {
  WARNING: 'Uyarı',
  MINOR: 'Hafif',
  MAJOR: 'Ağır',
  CRITICAL: 'Kritik',
};

export const QUALITY_FACTOR_LABELS: Record<QualityFactorKey, string> = {
  REVIEWS: 'Müşteri puanları',
  COMPLETION: 'Tamamlama oranı',
  CANCELLATION: 'Usta kaynaklı iptal',
  DISPUTES: 'Sorun bildirimi',
  RESPONSE: 'Yanıt hızı',
  VERIFICATION: 'Doğrulamalar',
  EXPERIENCE: 'Deneyim',
};

// ---------------------------------------------------------------------------
// Finans (Faz 5). Payment / cash / payout / earning status labels are shared
// from @ustago/validation so every app says the same thing.
// ---------------------------------------------------------------------------

export {
  CASH_STATUS_LABELS,
  EARNING_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYOUT_STATUS_LABELS,
} from '@ustago/validation';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodChoice, string> = {
  IN_APP: 'Uygulamadan',
  CASH: 'Ustaya doğrudan',
};

export const ATTEMPT_STATUS_LABELS: Record<PaymentAttemptStatus, string> = {
  PENDING: 'Bekliyor',
  SUCCEEDED: 'Başarılı',
  FAILED: 'Başarısız',
  CANCELLED: 'İptal edildi',
};

export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  REQUESTED: 'İşleniyor',
  SUCCEEDED: 'Tamamlandı',
  FAILED: 'Başarısız',
};

export const REFUND_REASON_LABELS: Record<RefundReason, string> = {
  JOB_CANCELLED: 'İş iptal edildi',
  DISPUTE_RESOLUTION: 'Sorun bildirimi kararı',
  SERVICE_ISSUE: 'Hizmet sorunu',
  CUSTOMER_REQUEST: 'Müşteri talebi',
  DUPLICATE_PAYMENT: 'Mükerrer ödeme',
  OTHER: 'Diğer',
};

/** Reasons an admin picks by hand (the other two are set by the system). */
export const ADMIN_REFUND_REASONS = [
  'SERVICE_ISSUE',
  'CUSTOMER_REQUEST',
  'DUPLICATE_PAYMENT',
  'OTHER',
] as const satisfies readonly RefundReason[];

export const LEDGER_ACCOUNT_LABELS: Record<LedgerAccountType, string> = {
  PROVIDER_PENDING: 'Usta bekleyen bakiye',
  PROVIDER_AVAILABLE: 'Usta kullanılabilir bakiye',
  PROVIDER_RESERVED: 'Usta ayrılmış bakiye (çekim)',
  PLATFORM_CLEARING: 'Platform tahsilat hesabı',
  PLATFORM_FEE_REVENUE: 'Platform hizmet bedeli geliri',
  REFUND_LIABILITY: 'İade yükümlülüğü',
  PROVIDER_PLATFORM_DEBT: 'Ustanın platforma borcu',
};

export const LEDGER_TRANSACTION_LABELS: Record<LedgerTransactionType, string> = {
  PAYMENT_CAPTURED: 'Ödeme tahsil edildi',
  EARNING_RELEASED: 'Kazanç serbest bırakıldı',
  CASH_FEE_ASSESSED: 'Nakit iş hizmet bedeli',
  REFUND_REQUESTED: 'İade talep edildi',
  REFUND_COMPLETED: 'İade tamamlandı',
  PAYOUT_RESERVED: 'Para çekme için ayrıldı',
  PAYOUT_PAID: 'Para çekme ödendi',
  PAYOUT_RELEASED: 'Para çekme geri bırakıldı',
  REVERSAL: 'Ters kayıt',
  ADJUSTMENT: 'Düzeltme',
};

export type DisputeFinancialActionType =
  | 'NO_FINANCIAL_ACTION'
  | 'FULL_CUSTOMER_REFUND'
  | 'PARTIAL_CUSTOMER_REFUND'
  | 'RELEASE_PROVIDER_FUNDS';

export const DISPUTE_FINANCIAL_ACTION_LABELS: Record<DisputeFinancialActionType, string> = {
  NO_FINANCIAL_ACTION: 'Finansal işlem yok',
  FULL_CUSTOMER_REFUND: 'Müşteriye tam iade',
  PARTIAL_CUSTOMER_REFUND: 'Müşteriye kısmi iade',
  RELEASE_PROVIDER_FUNDS: 'Ustaya aktar',
};

export const CASH_RESOLVE_LABELS: Record<'CONFIRM_PAID' | 'MARK_UNPAID', string> = {
  CONFIRM_PAID: 'Ödendi olarak onayla',
  MARK_UNPAID: 'Ödenmedi olarak kaydet',
};
