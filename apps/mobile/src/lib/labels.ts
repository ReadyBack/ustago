import type {
  ChangeOrderStatus,
  DisputeReason,
  DisputeStatus,
  JobStatus,
  JobStep,
  ProviderStatus,
  QuoteRevisionKind,
  QuoteStatus,
  ServiceRequestStatus,
} from '@ustago/types';

import type { Tone } from './theme';

type Label = { label: string; tone: Tone };

export const REQUEST_STATUS: Record<ServiceRequestStatus, Label> = {
  DRAFT: { label: 'Taslak', tone: 'neutral' },
  PUBLISHED: { label: 'Teklif bekleniyor', tone: 'info' },
  MATCHING: { label: 'Usta aranıyor', tone: 'warning' },
  QUOTED: { label: 'Teklif geldi', tone: 'info' },
  MATCHED: { label: 'Anlaşıldı', tone: 'success' },
  CANCELLED: { label: 'İptal edildi', tone: 'neutral' },
  EXPIRED: { label: 'Süresi doldu', tone: 'neutral' },
  COMPLETED: { label: 'Tamamlandı', tone: 'success' },
};

/** Quote status from the viewer's side. */
export function quoteStatusLabel(status: QuoteStatus, viewer: 'CUSTOMER' | 'PROVIDER'): Label {
  switch (status) {
    case 'PENDING_CUSTOMER':
      return viewer === 'CUSTOMER'
        ? { label: 'Yanıtınızı bekliyor', tone: 'warning' }
        : { label: 'Müşteri yanıtı bekleniyor', tone: 'info' };
    case 'PENDING_PROVIDER':
      return viewer === 'PROVIDER'
        ? { label: 'Yanıtınızı bekliyor', tone: 'warning' }
        : { label: 'Usta yanıtı bekleniyor', tone: 'info' };
    case 'ACCEPTED':
      return { label: 'Anlaşıldı', tone: 'success' };
    case 'REJECTED':
      return { label: viewer === 'CUSTOMER' ? 'Reddedildi' : 'Seçilmedi', tone: 'neutral' };
    case 'WITHDRAWN':
      return { label: 'Geri çekildi', tone: 'neutral' };
    case 'EXPIRED':
      return { label: 'Kapandı', tone: 'neutral' };
  }
}

export const REVISION_KIND: Record<QuoteRevisionKind, string> = {
  OFFER: 'Teklif',
  CUSTOMER_COUNTER: 'Müşterinin karşı teklifi',
  PROVIDER_COUNTER: 'Ustanın karşı teklifi',
};

export const JOB_STATUS: Record<JobStatus, Label> = {
  CREATED: { label: 'Anlaşıldı', tone: 'success' },
  CONFIRMED: { label: 'Onaylandı', tone: 'success' },
  PROVIDER_PREPARING: { label: 'Usta hazırlanıyor', tone: 'info' },
  PROVIDER_EN_ROUTE: { label: 'Usta yolda', tone: 'info' },
  PROVIDER_ARRIVED: { label: 'Usta geldi', tone: 'info' },
  IN_PROGRESS: { label: 'İş sürüyor', tone: 'info' },
  AWAITING_COMPLETION_CONFIRMATION: { label: 'Onay bekliyor', tone: 'warning' },
  COMPLETED: { label: 'Tamamlandı', tone: 'success' },
  DISPUTED: { label: 'Sorun bildirildi', tone: 'danger' },
  CANCELLED: { label: 'İptal edildi', tone: 'neutral' },
};

export const PROVIDER_STATUS: Record<ProviderStatus, Label> = {
  DRAFT: { label: 'Başvuru tamamlanmadı', tone: 'neutral' },
  PENDING_REVIEW: { label: 'İnceleniyor', tone: 'warning' },
  ACTIVE: { label: 'Onaylı usta', tone: 'success' },
  SUSPENDED: { label: 'Askıya alındı', tone: 'danger' },
  REJECTED: { label: 'Başvuru reddedildi', tone: 'danger' },
};

/** Timeline steps, as both sides read them. */
export const JOB_STEP: Record<JobStep, string> = {
  AGREED: 'Anlaşıldı',
  EN_ROUTE: 'Usta yola çıktı',
  ARRIVED: 'Usta adrese ulaştı',
  STARTED: 'İş başladı',
  COMPLETION_REQUESTED: 'Usta işi tamamladı',
  COMPLETED: 'İş tamamlandı',
};

export const CHANGE_ORDER_STATUS: Record<ChangeOrderStatus, Label> = {
  PENDING: { label: 'Onay bekliyor', tone: 'warning' },
  ACCEPTED: { label: 'Onaylandı', tone: 'success' },
  REJECTED: { label: 'Reddedildi', tone: 'neutral' },
  CANCELLED: { label: 'Geri çekildi', tone: 'neutral' },
  EXPIRED: { label: 'Sonuçlanmadan kapandı', tone: 'neutral' },
};

/** The categories a customer can pick in "Sorun Bildir" (payment issues do not exist yet). */
export const DISPUTE_REASONS: readonly { value: DisputeReason; label: string }[] = [
  { value: 'NO_SHOW', label: 'Usta gelmedi' },
  { value: 'POOR_QUALITY', label: 'İş kötü / eksik yapıldı' },
  { value: 'PRICE_DISAGREEMENT', label: 'Fiyat anlaşmazlığı' },
  { value: 'DAMAGE', label: 'Hasar verildi' },
  { value: 'MISCONDUCT', label: 'Uygunsuz davranış' },
  { value: 'OTHER', label: 'Diğer' },
];

export const DISPUTE_STATUS: Record<DisputeStatus, Label> = {
  OPEN: { label: 'İnceleniyor', tone: 'warning' },
  AWAITING_EVIDENCE: { label: 'Bilgi bekleniyor', tone: 'warning' },
  UNDER_REVIEW: { label: 'İnceleniyor', tone: 'warning' },
  RESOLVED_FOR_CUSTOMER: { label: 'Sonuçlandı', tone: 'success' },
  RESOLVED_FOR_PROVIDER: { label: 'Sonuçlandı', tone: 'success' },
  RESOLVED_PARTIAL: { label: 'Sonuçlandı', tone: 'success' },
  CLOSED: { label: 'Kapandı', tone: 'neutral' },
};
