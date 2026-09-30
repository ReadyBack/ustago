import type { AppNotification, NotificationCategory } from '@ustago/types';

/**
 * Notification centre tabs. The API groups rows into four categories
 * (JOBS, MESSAGES, FINANCE, ACCOUNT); offers and negotiation ("quote.*")
 * live under JOBS, so "Teklifler" and "İşler" split that category by type.
 */
export type NotificationTab = 'ALL' | 'JOBS' | 'QUOTES' | 'MESSAGES' | 'FINANCE' | 'ACCOUNT';

export const NOTIFICATION_TABS: {
  value: NotificationTab;
  label: string;
  category: NotificationCategory | null;
}[] = [
  { value: 'ALL', label: 'Tümü', category: null },
  { value: 'JOBS', label: 'İşler', category: 'JOBS' },
  { value: 'QUOTES', label: 'Teklifler', category: 'JOBS' },
  { value: 'MESSAGES', label: 'Mesajlar', category: 'MESSAGES' },
  { value: 'FINANCE', label: 'Ödemeler', category: 'FINANCE' },
  { value: 'ACCOUNT', label: 'Hesap', category: 'ACCOUNT' },
];

export const isQuoteNotification = (n: Pick<AppNotification, 'type'>) =>
  n.type.startsWith('quote.');

export function categoryForTab(tab: NotificationTab): NotificationCategory | null {
  return NOTIFICATION_TABS.find((t) => t.value === tab)?.category ?? null;
}

export function matchesTab(n: Pick<AppNotification, 'type' | 'category'>, tab: NotificationTab) {
  switch (tab) {
    case 'ALL':
      return true;
    case 'QUOTES':
      return n.category === 'JOBS' && isQuoteNotification(n);
    case 'JOBS':
      return n.category === 'JOBS' && !isQuoteNotification(n);
    default:
      return n.category === tab;
  }
}

export function filterByTab<T extends Pick<AppNotification, 'type' | 'category'>>(
  items: T[],
  tab: NotificationTab,
): T[] {
  return items.filter((n) => matchesTab(n, tab));
}
