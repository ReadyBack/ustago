import type {
  JobStatus,
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
  DISPUTED: { label: 'İtiraz var', tone: 'danger' },
  CANCELLED: { label: 'İptal edildi', tone: 'neutral' },
};

export const PROVIDER_STATUS: Record<ProviderStatus, Label> = {
  DRAFT: { label: 'Başvuru tamamlanmadı', tone: 'neutral' },
  PENDING_REVIEW: { label: 'İnceleniyor', tone: 'warning' },
  ACTIVE: { label: 'Onaylı usta', tone: 'success' },
  SUSPENDED: { label: 'Askıya alındı', tone: 'danger' },
  REJECTED: { label: 'Başvuru reddedildi', tone: 'danger' },
};
