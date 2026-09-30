import type {
  AdminPermission,
  AlertSeverity,
  AlertStatus,
  ChangeOrderStatus,
  ComponentState,
  DocumentScanStatus,
  FeePolicyLifecycle,
  ProviderAccountStatus,
  ProviderVerificationStatus,
  ReconciliationRunStatus,
  RiskSignalStatus,
  RiskSignalType,
  SuspensionStatus,
  WorkerStatus,
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
import type { SUSPENSION_REASON_CODES, VERIFICATION_REASON_CODES } from '@ustago/validation';

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
  BUSINESS_DOCUMENT: 'İşletme evrakı',
  OTHER: 'Diğer belge',
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

// ---------------------------------------------------------------------------
// Güven ve doğrulama (Faz 6)
// ---------------------------------------------------------------------------

export const PROVIDER_VERIFICATION_STATUS_LABELS: Record<ProviderVerificationStatus, string> = {
  NOT_STARTED: 'Başlamadı',
  IN_PROGRESS: 'Hazırlanıyor',
  SUBMITTED: 'Gönderildi',
  UNDER_REVIEW: 'İnceleniyor',
  NEEDS_REVISION: 'Revizyon istendi',
  VERIFIED: 'Doğrulandı',
  REJECTED: 'Reddedildi',
  SUSPENDED: 'Askıda',
};

/** The statuses the "Doğrulama Talepleri" queue can be filtered by (API default: SUBMITTED). */
export const VERIFICATION_CASE_FILTERS = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'NEEDS_REVISION',
  'VERIFIED',
  'REJECTED',
  'SUSPENDED',
] as const satisfies readonly ProviderVerificationStatus[];

export const ACCOUNT_STATUS_LABELS: Record<ProviderAccountStatus, string> = {
  ACTIVE: 'Aktif',
  LIMITED: 'Kısıtlı',
  SUSPENDED: 'Askıda',
  BANNED: 'Kalıcı olarak kapatıldı',
};

export const DOCUMENT_SCAN_STATUS_LABELS: Record<DocumentScanStatus, string> = {
  NOT_SCANNED: 'Taranmadı',
  SAFE: 'Temiz',
  REJECTED: 'Reddedildi',
  QUARANTINED: 'Karantinada',
};

export const VERIFICATION_REASON_LABELS: Record<
  (typeof VERIFICATION_REASON_CODES)[number],
  string
> = {
  DOCUMENT_UNREADABLE: 'Belge okunamıyor',
  DOCUMENT_EXPIRED: 'Belgenin süresi dolmuş',
  DOCUMENT_MISMATCH: 'Belge bilgileri uyuşmuyor',
  MISSING_DOCUMENT: 'Eksik belge',
  PROFILE_INCOMPLETE: 'Profil eksik',
  SUSPECTED_FRAUD: 'Sahtecilik şüphesi',
  NOT_ELIGIBLE: 'Koşulları sağlamıyor',
  OTHER: 'Diğer',
};

export const SUSPENSION_REASON_LABELS: Record<(typeof SUSPENSION_REASON_CODES)[number], string> = {
  QUALITY_ISSUES: 'Kalite sorunları',
  POLICY_VIOLATION: 'Kural ihlali',
  FRAUD_INVESTIGATION: 'Dolandırıcılık incelemesi',
  DOCUMENT_ISSUE: 'Belge sorunu',
  PAYMENT_ISSUE: 'Ödeme sorunu',
  LEGACY_SUSPENSION: 'Eski sistemden askı',
  OTHER: 'Diğer',
};

export const SUSPENSION_STATUS_LABELS: Record<SuspensionStatus, string> = {
  ACTIVE: 'Yürürlükte',
  LIFTED: 'Kaldırıldı',
  EXPIRED: 'Süresi doldu',
  EXPIRED_PENDING_REVIEW: 'Süresi doldu, inceleme bekliyor',
};

export const SUSPENSION_LEVEL_LABELS: Record<'SUSPENDED' | 'BANNED' | 'LIMITED', string> = {
  SUSPENDED: 'Askıya alma',
  BANNED: 'Kalıcı kapatma',
  LIMITED: 'Kısıtlama',
};

export const TIMELINE_ACTOR_LABELS: Record<'PROVIDER' | 'ADMIN' | 'SYSTEM', string> = {
  PROVIDER: 'Usta',
  ADMIN: 'Yönetici',
  SYSTEM: 'Sistem',
};

// ---------------------------------------------------------------------------
// Operasyon ve güvenlik (Faz 6)
// ---------------------------------------------------------------------------

export const FEE_POLICY_LIFECYCLE_LABELS: Record<FeePolicyLifecycle, string> = {
  DRAFT: 'Taslak',
  SCHEDULED: 'Planlandı',
  ACTIVE: 'Yürürlükte',
  RETIRED: 'Kullanımdan kalktı',
};

export const ALERT_SEVERITY_LABELS: Record<AlertSeverity, string> = {
  INFO: 'Bilgi',
  WARNING: 'Uyarı',
  CRITICAL: 'Kritik',
};

export const ALERT_STATUS_LABELS: Record<AlertStatus | 'ACTIVE', string> = {
  ACTIVE: 'Açık ve ilgilenilen',
  OPEN: 'Açık',
  ACKNOWLEDGED: 'İlgileniliyor',
  RESOLVED: 'Kapatıldı',
};

export const RECONCILIATION_RUN_STATUS_LABELS: Record<ReconciliationRunStatus, string> = {
  RUNNING: 'Çalışıyor',
  SUCCEEDED: 'Tamamlandı',
  FAILED: 'Hata verdi',
};

export const RECONCILIATION_TRIGGER_LABELS: Record<'SCHEDULED' | 'MANUAL', string> = {
  SCHEDULED: 'Zamanlanmış',
  MANUAL: 'Elle',
};

export const COMPONENT_STATE_LABELS: Record<ComponentState, string> = {
  up: 'Çalışıyor',
  down: 'Çalışmıyor',
  degraded: 'Sorunlu',
  disabled: 'Kapalı',
  unknown: 'Bilinmiyor',
};

export const COMPONENT_LABELS: Record<
  'api' | 'database' | 'redis' | 'pushOutbox' | 'reconciliation',
  string
> = {
  api: 'API',
  database: 'Veritabanı',
  redis: 'Redis',
  pushOutbox: 'Bildirim kuyruğu',
  reconciliation: 'Mutabakat',
};

export const WORKER_HEALTH_LABELS: Record<WorkerStatus['health'], string> = {
  ok: 'Sağlıklı',
  stale: 'Gecikmiş',
  failing: 'Hata veriyor',
  never_ran: 'Hiç çalışmadı',
  disabled: 'Kapalı',
};

export const ADMIN_PERMISSION_LABELS: Record<AdminPermission, string> = {
  ADMIN_SUPPORT: 'Destek',
  ADMIN_VERIFICATION: 'Doğrulama',
  ADMIN_FINANCE: 'Finans',
  ADMIN_SUPER: 'Süper yönetici (tüm yetkiler)',
};

export const RISK_SIGNAL_TYPE_LABELS: Record<RiskSignalType, string> = {
  OTP_ABUSE: 'Doğrulama kodu kötüye kullanımı',
  QUOTE_SPAM: 'Teklif spamı',
  CANCEL_ABUSE: 'İptal kötüye kullanımı',
  PAYMENT_ABUSE: 'Ödeme kötüye kullanımı',
  REVIEW_ABUSE: 'Değerlendirme kötüye kullanımı',
  DEVICE_ANOMALY: 'Cihaz anomalisi',
  ADMIN_FLAG: 'Yönetici işareti',
};

export const RISK_SIGNAL_STATUS_LABELS: Record<RiskSignalStatus, string> = {
  OPEN: 'Açık',
  REVIEWED: 'İncelendi',
  DISMISSED: 'Yok sayıldı',
};

export const PAYOUT_RESOLVE_LABELS: Record<'PAID' | 'FAILED', string> = {
  PAID: 'Sağlayıcı ödedi (PAID)',
  FAILED: 'Sağlayıcı ödemedi (FAILED)',
};

// -- Faz 7: pazar yeri, kategori içeriği, mesaj şikayetleri -------------------

export const LAUNCH_STATUS_LABELS: Record<'ACTIVE' | 'WAITLIST' | 'DISABLED', string> = {
  ACTIVE: 'Açık',
  WAITLIST: 'Bekleme listesi',
  DISABLED: 'Kapalı',
};

/** What each launch status means for customers and providers. */
export const LAUNCH_STATUS_HINTS: Record<'ACTIVE' | 'WAITLIST' | 'DISABLED', string> = {
  ACTIVE: 'İl pazar yerinde açık: talepler ustalara dağıtılır.',
  WAITLIST: 'İl kapalı; müşteriler talep bırakabilir, talepler usta bulunana kadar bekler.',
  DISABLED: 'İl kapalı: yeni talep alınmaz.',
};

export const QUESTION_TYPE_LABELS: Record<
  'SINGLE_SELECT' | 'MULTI_SELECT' | 'BOOLEAN' | 'SHORT_TEXT' | 'NUMBER',
  string
> = {
  SINGLE_SELECT: 'Tek seçim',
  MULTI_SELECT: 'Çoklu seçim',
  BOOLEAN: 'Evet / Hayır',
  SHORT_TEXT: 'Kısa metin',
  NUMBER: 'Sayı',
};

export const PHOTO_POLICY_LABELS: Record<'OPTIONAL' | 'RECOMMENDED' | 'REQUIRED', string> = {
  OPTIONAL: 'İsteğe bağlı',
  RECOMMENDED: 'Önerilir',
  REQUIRED: 'Zorunlu',
};

export const NOTIFY_MODE_LABELS: Record<'PUSH' | 'IN_APP' | 'NONE', string> = {
  PUSH: 'Anlık bildirim',
  IN_APP: 'Uygulama içi',
  NONE: 'Bildirim yok',
};

export const DISPATCH_RESULT_LABELS: Record<'PENDING' | 'QUOTED' | 'CLOSED', string> = {
  PENDING: 'Bekliyor',
  QUOTED: 'Teklif verdi',
  CLOSED: 'Kapandı',
};

export const MARKETPLACE_EVENT_LABELS: Record<string, string> = {
  request_created: 'Talep oluşturuldu',
  request_dispatched: 'Talep ustalara gönderildi',
  provider_viewed_request: 'Usta talebi görüntüledi',
  quote_created: 'Teklif verildi',
  quote_accepted: 'Teklif kabul edildi',
  job_started: 'İş başladı',
  job_completed: 'İş tamamlandı',
  conversation_started: 'Konuşma başladı',
  message_sent: 'Mesaj gönderildi',
  provider_favorited: 'Usta favorilere eklendi',
  provider_rehired: 'Usta yeniden tutuldu',
  search_performed: 'Arama yapıldı',
  search_no_result: 'Arama sonuçsuz',
  search_category_clicked: 'Aramadan kategori seçildi',
  request_no_offer: 'Talep teklifsiz kaldı',
  request_search_expanded: 'Arama genişletildi',
};

export const MESSAGE_REPORT_REASON_LABELS: Record<
  'SPAM' | 'HARASSMENT' | 'FRAUD' | 'CONTACT_INFO' | 'INAPPROPRIATE' | 'OTHER',
  string
> = {
  SPAM: 'İstenmeyen mesaj (spam)',
  HARASSMENT: 'Taciz / hakaret',
  FRAUD: 'Dolandırıcılık şüphesi',
  CONTACT_INFO: 'İletişim bilgisi paylaşımı',
  INAPPROPRIATE: 'Uygunsuz içerik',
  OTHER: 'Diğer',
};

export const MESSAGE_REPORT_STATUS_LABELS: Record<'OPEN' | 'REVIEWED' | 'DISMISSED', string> = {
  OPEN: 'Açık',
  REVIEWED: 'İncelendi',
  DISMISSED: 'Yok sayıldı',
};

export const CONVERSATION_ROLE_LABELS: Record<'CUSTOMER' | 'PROVIDER', string> = {
  CUSTOMER: 'Müşteri',
  PROVIDER: 'Usta',
};

/** Label for a status string from a loosely typed API field; unknown values show as-is. */
export function labelOf(labels: Record<string, string>, key: string): string {
  return Object.hasOwn(labels, key) ? (labels[key] as string) : key;
}
