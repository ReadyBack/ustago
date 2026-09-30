import type { ConversationDetail, ConversationListItem, MessageReportReason } from '@ustago/types';

/** Shown when a message or the draft looks like a phone number or e-mail. Never blocks. */
export const CONTACT_REMINDER = 'Güvenliğin için ödeme ve iletişimi UstaGO içinde tut.';

export const PRICE_NOTE = 'Fiyat değişikliği sohbetten değil, teklif/ek iş üzerinden yapılır.';

/** Honest about how new messages arrive: polling, not a live connection. */
export const POLLING_NOTE = 'Yeni mesajlar bu ekran açıkken birkaç saniyede bir kontrol edilir.';

export const REPORT_REASONS: readonly { value: MessageReportReason; label: string }[] = [
  { value: 'SPAM', label: 'İstenmeyen mesaj / reklam' },
  { value: 'HARASSMENT', label: 'Taciz veya hakaret' },
  { value: 'FRAUD', label: 'Dolandırıcılık şüphesi' },
  { value: 'CONTACT_INFO', label: 'Platform dışına yönlendirme' },
  { value: 'INAPPROPRIATE', label: 'Uygunsuz içerik' },
  { value: 'OTHER', label: 'Diğer' },
];

export function cannotSendText(d: ConversationDetail): string | null {
  if (d.canSend) return null;
  if (d.cannotSendReason === 'BLOCKED') {
    return d.blockedByMe
      ? 'Bu kişiyi engelledin. Mesaj göndermek için menüden engeli kaldırabilirsin.'
      : 'Bu sohbete şu an mesaj gönderilemiyor.';
  }
  if (d.cannotSendReason === 'CLOSED') {
    return 'Talep anlaşma olmadan kapandığı için sohbet kapandı. Eski mesajları okuyabilirsin.';
  }
  return 'Bu sohbete şu an mesaj gönderilemiyor.';
}

export function lastMessagePreview(c: ConversationListItem): string {
  const m = c.lastMessage;
  if (!m) return 'Henüz mesaj yok';
  const text = m.type === 'IMAGE' ? '📷 Fotoğraf' : m.preview;
  return m.mine && m.type !== 'SYSTEM' ? `Sen: ${text}` : text;
}

/** "14:05" today, otherwise "12 Eyl 14:05" (Türkiye saati). */
export function messageTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = { timeZone: 'Europe/Istanbul' };
  const day = (x: Date) => x.toLocaleDateString('tr-TR', opts);
  const time = d.toLocaleTimeString('tr-TR', { ...opts, hour: '2-digit', minute: '2-digit' });
  if (day(d) === day(now)) return time;
  const date = d.toLocaleDateString('tr-TR', { ...opts, day: 'numeric', month: 'short' });
  return `${date} ${time}`;
}
