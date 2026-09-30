import type { Money } from '@ustago/types';
import { formatMoney } from '@ustago/validation';

export { formatMoney };

/** "₺1.500" or "Bütçe belirtilmedi". */
export function formatBudget(budget: Money | null): string {
  return budget ? formatMoney(budget) : 'Bütçe belirtilmedi';
}

const dateTime = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});
const timeOnly = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });
const dateOnly = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTime.format(new Date(iso)) : '—';
}

/** "12 Ekim 14:00 – 18:00" or a single time when there is no end. */
export function formatDateRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  if (!start) return '—';
  if (!end) return formatDateTime(start);
  const from = new Date(start);
  const to = new Date(end);
  const sameDay = dateOnly.format(from) === dateOnly.format(to);
  return `${dateTime.format(from)} – ${sameDay ? timeOnly.format(to) : dateTime.format(to)}`;
}

export function formatDate(iso: string | null | undefined): string {
  return iso ? dateOnly.format(new Date(iso)) : '—';
}

/** "3 dk önce", "2 saat önce", "dün", else a date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'az önce';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} saat önce`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'dün';
  if (days < 7) return `${days} gün önce`;
  return formatDate(iso);
}

/** "+90 500 000 00 01" from E.164. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '—';
  const m = /^\+90(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(e164);
  return m ? `+90 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : e164;
}

/** Keeps only the 10 national digits the user typed after +90. */
export function phoneDigits(input: string): string {
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('90') && digits.length > 10) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, 10);
}

/** "500 000 00 01" while typing. */
export function formatPhoneInput(digits: string): string {
  const parts = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 8), digits.slice(8, 10)];
  return parts.filter(Boolean).join(' ');
}

export function formatDuration(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes < 60) return `${minutes} dk`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} saat` : `${h} saat ${m} dk`;
}
