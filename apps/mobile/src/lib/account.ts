import type {
  AccountDeletionRequestView,
  AccountDeletionStatus,
  ActiveSession,
  DataExportRequestView,
} from '@ustago/types';

import { ApiError } from '../api/client';
import type { Tone } from './theme';

type Label = { label: string; tone: Tone };

/** The server only accepts this exact phrase as the deletion confirmation. */
export const ACCOUNT_DELETION_PHRASE = 'HESABIMI SIL';

/**
 * Whether the typed text is the confirmation phrase. Case and the Turkish
 * dotless/dotted i are forgiven ("hesabımı sil", "HESABIMI SİL"); the
 * request itself always sends the exact phrase the server expects.
 */
export function isDeletionConfirmation(input: string): boolean {
  const normalised = input
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[İı]/g, 'I')
    .replace(/i/g, 'I')
    .toUpperCase();
  return normalised === ACCOUNT_DELETION_PHRASE;
}

export const DELETION_STATUS: Record<AccountDeletionStatus, Label> = {
  REQUESTED: { label: 'Silme talebi alındı', tone: 'warning' },
  BLOCKED_BY_ACTIVE_JOB: { label: 'Bekliyor: açık işlemler var', tone: 'danger' },
  PROCESSING: { label: 'İşleniyor', tone: 'info' },
  COMPLETED: { label: 'Tamamlandı', tone: 'success' },
  CANCELLED: { label: 'İptal edildi', tone: 'neutral' },
};

const BLOCKER_LABELS: Record<string, string> = {
  ACTIVE_JOB: 'Devam eden bir işiniz var. İş tamamlanınca veya iptal edilince silme işlenir.',
  OPEN_DISPUTE: 'Sonuçlanmamış bir sorun bildiriminiz (itiraz) var.',
  OPEN_PAYOUT: 'Sonuçlanmamış bir para çekme talebiniz var.',
};

export function blockerLabel(code: string): string {
  return BLOCKER_LABELS[code] ?? 'Hesabınızda henüz kapanmamış bir işlem var.';
}

/** A request that still waits for the grace period or its blockers (it can be cancelled). */
export function deletionCancellable(view: AccountDeletionRequestView | null): boolean {
  return view?.status === 'REQUESTED' || view?.status === 'BLOCKED_BY_ACTIVE_JOB';
}

/** A request is open until it completes or is cancelled. */
export function deletionOpen(view: AccountDeletionRequestView | null): boolean {
  return deletionCancellable(view) || view?.status === 'PROCESSING';
}

/** Blockers sent in an error's details (e.g. a 409), if any. */
export function blockersFromError(error: unknown): string[] {
  if (!(error instanceof ApiError)) return [];
  const d = error.details;
  if (d && typeof d === 'object' && 'blockers' in d) {
    const b = (d as { blockers: unknown }).blockers;
    if (Array.isArray(b)) return b.filter((x): x is string => typeof x === 'string');
  }
  return [];
}

export const DATA_EXPORT_STATUS: Record<DataExportRequestView['status'], Label> = {
  REQUESTED: { label: 'Talep kaydedildi', tone: 'info' },
  PROCESSING: { label: 'Hazırlanıyor', tone: 'warning' },
  READY: { label: 'Hazır', tone: 'success' },
  EXPIRED: { label: 'Süresi doldu', tone: 'neutral' },
  FAILED: { label: 'Hazırlanamadı', tone: 'danger' },
};

/** An open export request: a second one is not needed. */
export function hasOpenExport(list: DataExportRequestView[]): boolean {
  return list.some((e) => e.status === 'REQUESTED' || e.status === 'PROCESSING');
}

const PLATFORM: Record<NonNullable<ActiveSession['platform']>, string> = {
  IOS: 'iPhone / iPad',
  ANDROID: 'Android',
  WEB: 'Web tarayıcısı',
};

/** "iPhone 15 · iPhone / iPad", falling back to whatever the server knows. */
export function sessionTitle(s: ActiveSession): string {
  const platform = s.platform ? PLATFORM[s.platform] : null;
  const parts = [s.deviceName, platform].filter((p): p is string => !!p && p.length > 0);
  if (parts.length === 0 && s.userAgentSummary) return s.userAgentSummary;
  return parts.length > 0 ? parts.join(' · ') : 'Bilinmeyen cihaz';
}

/** The current device first, then the most recently used. */
export function sortSessions(list: ActiveSession[]): ActiveSession[] {
  return [...list].sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return b.lastUsedAt.localeCompare(a.lastUsedAt);
  });
}
