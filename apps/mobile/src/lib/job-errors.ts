import { ApiError } from '../api/client';

/**
 * Job action errors in plain Turkish. A 409 means the job moved on the
 * other side (or on another device): the caller refreshes and shows the
 * current state instead of guessing.
 */
const MESSAGES: Record<string, string> = {
  JOB_INVALID_TRANSITION: 'İşin mevcut durumunda bu işlem yapılamaz.',
  JOB_HAS_PENDING_CHANGE_ORDER: 'Önce bekleyen ek iş talebinin sonuçlanması gerekiyor.',
  JOB_WRONG_PARTY: 'Bu adım işin diğer tarafına ait.',
  JOB_NOT_FOUND: 'İş bulunamadı.',
  CHANGE_ORDER_NOT_PENDING: 'Bu ek iş talebi zaten yanıtlanmış. Güncel durum gösteriliyor.',
  CHANGE_ORDER_ALREADY_PENDING: 'Yanıt bekleyen bir ek iş talebiniz zaten var.',
  CHANGE_ORDER_NOT_ALLOWED: 'Ek iş yalnızca iş devam ederken eklenebilir.',
  CHANGE_ORDER_STALE: 'İşin toplamı değişti. Güncel durum gösteriliyor.',
  CHANGE_ORDER_INVALID_AMOUNT: 'Ek iş tutarı geçersiz.',
  DISPUTE_ALREADY_OPEN: 'Bu iş için açık bir sorun bildiriminiz zaten var.',
  DISPUTE_REASON_NOT_ALLOWED: 'Usta adrese gelmeden yalnızca "Usta gelmedi" bildirilebilir.',
  REVIEW_ALREADY_EXISTS: 'Bu iş için zaten değerlendirme yaptınız.',
  REVIEW_NOT_EDITABLE: 'Değerlendirme yalnızca ilk 30 gün içinde düzenlenebilir.',
  REVIEW_NOT_ALLOWED: 'Değerlendirme yalnızca tamamlanan işler için yapılabilir.',
};

/** Codes after which the screen must reload the job: the state changed elsewhere. */
const STALE = new Set([
  'JOB_INVALID_TRANSITION',
  'JOB_HAS_PENDING_CHANGE_ORDER',
  'CHANGE_ORDER_NOT_PENDING',
  'CHANGE_ORDER_ALREADY_PENDING',
  'CHANGE_ORDER_STALE',
  'DISPUTE_ALREADY_OPEN',
  'REVIEW_ALREADY_EXISTS',
]);

export function isStaleJobError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 409 || STALE.has(error.code));
}

/** Rethrows with a friendly message; validation messages from the server are kept. */
export function toJobError(error: unknown): unknown {
  if (!(error instanceof ApiError)) return error;
  const message = MESSAGES[error.code];
  return message ? new ApiError(error.status, error.code, message, error.details) : error;
}
