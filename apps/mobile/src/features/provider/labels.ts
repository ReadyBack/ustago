import type {
  ApproxDistance,
  AvailabilityState,
  Money,
  QuoteEta,
  ScheduleOption,
} from '@ustago/types';
import { formatMoney } from '@ustago/validation';

import type { Tone } from '../../lib/theme';

export const SCHEDULE_OPTION: Record<ScheduleOption, string> = {
  NOW: 'Hemen',
  TODAY: 'Bugün',
  TOMORROW: 'Yarın',
  DATE: 'Belirli bir tarih',
};

export const QUOTE_ETA_OPTIONS: readonly { value: QuoteEta; label: string }[] = [
  { value: 'MIN_30', label: '30 dk içinde' },
  { value: 'HOUR_1', label: '1 saat içinde' },
  { value: 'HOUR_2', label: '2 saat içinde' },
  { value: 'TODAY', label: 'Bugün' },
  { value: 'TOMORROW', label: 'Yarın' },
  { value: 'CUSTOM', label: 'Özel tarih' },
];

export const QUOTE_ETA: Record<QuoteEta, string> = Object.fromEntries(
  QUOTE_ETA_OPTIONS.map((o) => [o.value, o.label]),
) as Record<QuoteEta, string>;

export const AVAILABILITY_STATE: Record<
  AvailabilityState,
  { label: string; tone: Tone; body: string }
> = {
  AVAILABLE: {
    label: 'Yeni iş alıyorsun',
    tone: 'success',
    body: 'Uygun talepler sana gönderilir.',
  },
  OUTSIDE_HOURS: {
    label: 'Çalışma saatlerin dışındasın',
    tone: 'info',
    body: 'Teklif istekleri yine gelir; çalışma saatlerindeki ustalar önce gösterilir.',
  },
  UNAVAILABLE_TODAY: {
    label: 'Bugün müsait değilsin',
    tone: 'warning',
    body: 'Bugün sana yeni iş gönderilmez.',
  },
  TIME_OFF: {
    label: 'İzindesin',
    tone: 'warning',
    body: 'İzin bitene kadar sana yeni iş gönderilmez.',
  },
  PAUSED: {
    label: 'Yeni iş almıyorsun',
    tone: 'neutral',
    body: 'Açana kadar sana yeni talep gönderilmez. Mevcut işlerin ve tekliflerin devam eder.',
  },
};

/** ISO weekday 1-7. */
export const WEEKDAYS: readonly { value: number; label: string; short: string }[] = [
  { value: 1, label: 'Pazartesi', short: 'Pzt' },
  { value: 2, label: 'Salı', short: 'Sal' },
  { value: 3, label: 'Çarşamba', short: 'Çar' },
  { value: 4, label: 'Perşembe', short: 'Per' },
  { value: 5, label: 'Cuma', short: 'Cum' },
  { value: 6, label: 'Cumartesi', short: 'Cmt' },
  { value: 7, label: 'Pazar', short: 'Paz' },
];

/** Straight-line, district-centre based: always "Yaklaşık". */
export function distanceLabel(d: ApproxDistance | null): string | null {
  if (!d) return null;
  return `Yaklaşık ${Math.max(1, Math.round(d.km))} km`;
}

/** "₺1.500–₺2.000", "₺1.500" or "Bütçe belirtilmedi". */
export function budgetRangeLabel(min: Money | null, max: Money | null): string {
  if (!min) return 'Bütçe belirtilmedi';
  if (max && max.amountMinor > min.amountMinor) return `${formatMoney(min)}–${formatMoney(max)}`;
  return formatMoney(min);
}

/** 540 → "09:00". */
export function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "9", "09:00", "9.30" → minutes; "24:00" → 1440; null when unclear. */
export function parseHHMM(text: string): number | null {
  const match = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(text.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2] ?? '0');
  if (m > 59 || h > 24 || (h === 24 && m > 0)) return null;
  return h * 60 + m;
}

/**
 * "31.12.2026" (+ optional "14:30") → ISO in Türkiye saati (+03:00, no DST
 * since 2016). Null when the date does not exist.
 */
export function parseTrDate(dateText: string, timeText = '00:00'): string | null {
  const match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(dateText.trim());
  const minutes = parseHHMM(timeText);
  if (!match || minutes === null || minutes >= 1440) return null;
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}T${minutesToHHMM(minutes)}:00+03:00`;
}

/** Today in Türkiye saati as "GG.AA.YYYY", offset by `days`. */
export function trDateText(days = 0, now = new Date()): string {
  const d = new Date(now.getTime() + 3 * 3_600_000 + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}
