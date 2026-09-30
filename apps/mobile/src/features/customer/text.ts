import type {
  ApproxDistance,
  DispatchSummary,
  PriceGuide,
  ProviderSort,
  QuoteComparisonLabel,
  QuoteEta,
  ResponseStats,
} from '@ustago/types';

import { formatDateTime, formatMoney } from '../../lib/format';

/**
 * Customer-facing wording for Faz 7 data. Every sentence here describes a
 * real value from the API; nothing is estimated on the device.
 */

export const WAITLIST_TEXT = 'Bu ilde henüz az usta var; talebin bekleme listesine alınır';

export const UNAVAILABLE_TEXT = 'Bu usta şu an hizmet vermiyor';

/** Straight line between district centres: always "Yaklaşık", never a road distance. */
export function distanceText(d: ApproxDistance | null | undefined): string | null {
  if (!d) return null;
  const km = Math.max(1, Math.round(d.km));
  return `Yaklaşık ${km} km`;
}

/** Shown only when the API sent real stats (null below the minimum sample). */
export function responseText(s: ResponseStats | null | undefined): string | null {
  if (!s) return null;
  const m = Math.max(1, Math.round(s.medianMinutes));
  if (m < 60) return `Genellikle ~${m} dk içinde yanıt verir`;
  const h = Math.round(m / 60);
  return `Genellikle ~${h} saat içinde yanıt verir`;
}

export const SORT_OPTIONS: { value: ProviderSort; label: string }[] = [
  { value: 'RECOMMENDED', label: 'Önerilen' },
  { value: 'NEAREST', label: 'En yakın' },
  { value: 'RATING', label: 'En yüksek puan' },
  { value: 'COMPLETED_JOBS', label: 'En çok iş' },
  { value: 'RESPONSE_TIME', label: 'En hızlı yanıt' },
];

/** Objective labels only; there is deliberately no "en iyi". */
export const COMPARISON_LABEL: Record<QuoteComparisonLabel, string> = {
  LOWEST_PRICE: 'En düşük fiyat',
  NEAREST: 'En yakın',
  HIGHEST_RATED: 'En yüksek puan',
};

const ETA: Record<Exclude<QuoteEta, 'CUSTOM'>, string> = {
  MIN_30: '30 dk içinde',
  HOUR_1: '1 saat içinde',
  HOUR_2: '2 saat içinde',
  TODAY: 'Bugün',
  TOMORROW: 'Yarın',
};

/** The provider's own arrival estimate, as they chose it on the quote. */
export function etaText(eta: QuoteEta | null, availableFrom: string | null): string | null {
  if (!eta) return null;
  if (eta === 'CUSTOM') return availableFrom ? `${formatDateTime(availableFrom)} itibarıyla` : null;
  return ETA[eta];
}

export function ratingText(r: { average: number; count: number } | null): string | null {
  if (!r) return null;
  return `${r.average.toFixed(1).replace('.', ',')} (${r.count} değerlendirme)`;
}

/** "7 uygun ustaya gönderildi · 3 görüntüledi · 1 teklif". */
export function dispatchProgressText(d: DispatchSummary): string | null {
  if (d.dispatchedCount <= 0) return null;
  const parts = [`${d.dispatchedCount} uygun ustaya gönderildi`];
  if (d.viewedCount > 0) parts.push(`${d.viewedCount} görüntüledi`);
  parts.push(d.quoteCount > 0 ? `${d.quoteCount} teklif` : 'henüz teklif yok');
  return parts.join(' · ');
}

export function supplyText(d: DispatchSummary): string | null {
  switch (d.supply) {
    case 'NONE':
      return 'Şu an bu bölgede bu hizmeti veren uygun usta bulunamadı. Arama alanını genişletebilir veya daha sonra tekrar bakabilirsin.';
    case 'WAITLIST':
      return 'Bu ilde henüz az usta var; talebin bekleme listesine alındı. Uygun usta katıldığında talebin ona iletilir.';
    default:
      return null;
  }
}

const PREFERRED_STATUS: Record<
  NonNullable<DispatchSummary['preferredProvider']>['status'],
  string
> = {
  WAITING: 'henüz görüntülemedi',
  VIEWED: 'talebini görüntüledi',
  QUOTED: 'teklif verdi',
  UNAVAILABLE: 'şu an müsait değil',
};

export function preferredProviderText(d: DispatchSummary): string | null {
  const p = d.preferredProvider;
  if (!p) return null;
  const base = `${p.displayName} ${PREFERRED_STATUS[p.status]}`;
  return p.only ? `${base} · Talep yalnızca bu ustaya gönderildi` : base;
}

export function priceGuideText(g: PriceGuide | null | undefined): string | null {
  if (!g) return null;
  if (g.status === 'INSUFFICIENT_DATA') return 'Henüz yeterli veri yok';
  const where = g.scope === 'PROVINCE' ? 'Bu bölgede' : 'Türkiye genelinde';
  return `${where} benzer işler genellikle ${formatMoney(g.p25)}–${formatMoney(g.p75)} (medyan ${formatMoney(g.median)}, ${g.sampleSizeFloor}+ iş)`;
}
