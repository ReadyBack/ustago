/** Shown for every 403: the admin lacks the permission the action needs. */
export const FORBIDDEN_MESSAGE = 'Bu işlem için yetkiniz yok.';

/** Shown when a verification case changed after the page was rendered. */
export const VERSION_CONFLICT_MESSAGE =
  'Kayıt başka biri tarafından güncellendi, sayfayı yenileyin.';

/**
 * Turkish messages for the Faz 6 admin error codes. Codes not listed fall
 * back to the API's own (already Turkish) message.
 */
export const FAZ6_ERROR_MESSAGES: Record<string, string> = {
  VERIFICATION_VERSION_CONFLICT: VERSION_CONFLICT_MESSAGE,
  PROVIDER_VERIFICATION_INVALID_TRANSITION:
    'Başvurunun durumu bu işleme izin vermiyor; sayfayı yenileyin.',
  VERIFICATION_REQUIRED: 'Zorunlu belgeler eksik; onaylamadan önce revizyon isteyin.',
  VERIFICATION_CASE_NOT_FOUND: 'Doğrulama başvurusu bulunamadı.',
  CANNOT_REVIEW_SELF: 'Kendi hesabınızda işlem yapamazsınız.',
  PROVIDER_NOT_FOUND: 'Usta bulunamadı.',
  PROVIDER_ALREADY_SUSPENDED: 'Bu usta zaten askıda.',
  SUSPENSION_NOT_FOUND: 'Bu ustanın açık bir askısı yok.',
  SUSPENSION_EXPIRY_IN_PAST: 'Bitiş zamanı gelecekte olmalı.',
  CATEGORY_NOT_FOUND: 'Kategori bulunamadı.',
  CATEGORY_REQUIREMENT_EXISTS: 'Bu belge bu kategori için zaten zorunlu.',
  CATEGORY_REQUIREMENT_NOT_FOUND: 'Zorunlu belge kaydı bulunamadı.',
  FEE_POLICY_CODE_TAKEN: 'Bu kod başka bir politikada kullanılıyor.',
  FEE_POLICY_ALREADY_PUBLISHED: 'Bu politika zaten yayınlandı; değiştirilemez veya silinemez.',
  FEE_POLICY_START_IN_PAST:
    'Başlangıç zamanı gelecekte olmalı. Geriye dönük komisyon uygulanamaz; yeni bir taslak oluşturun.',
  FEE_POLICY_START_CONFLICT:
    'Aynı anda başlayan yayınlanmış bir politika var. Başka bir başlangıç zamanı seçin.',
  FEE_POLICY_NOT_RETIRABLE:
    'Yalnızca henüz başlamamış (planlanmış) politikalar iptal edilebilir. Yürürlükteki politikayı değiştirmek için yeni bir politika yayınlayın.',
  FEE_POLICY_NOT_FOUND: 'Komisyon politikası bulunamadı.',
  ALERT_NOT_FOUND: 'Uyarı bulunamadı.',
  ALERT_INVALID_STATE: 'Uyarının durumu değişmiş; sayfayı yenileyin.',
  RECONCILIATION_RUNNING: 'Bir mutabakat zaten çalışıyor; bitince sayfayı yenileyin.',
  RUNTIME_FLAG_NOT_FOUND: 'Özellik anahtarı bulunamadı.',
  ADMIN_SELF_PERMISSION_CHANGE: 'Kendi yetkilerinizi değiştiremezsiniz.',
  USER_NOT_ADMIN: 'Yetki yalnızca yönetici hesaplarına verilebilir.',
  USER_NOT_FOUND: 'Kullanıcı bulunamadı.',
  PAYOUT_NOT_FOUND: 'Para çekme talebi bulunamadı.',
  PAYOUT_INVALID_STATE: 'Talebin durumu değişmiş; sayfayı yenileyin.',
  PAYOUT_DESTINATION_NOT_FOUND: 'Banka hesabı bulunamadı.',
  API_UNREACHABLE: 'API’ye ulaşılamıyor.',
};

/**
 * The message an admin sees for a failed API call. A 403 without a more
 * specific known code (missing role or permission grant) always reads
 * "Bu işlem için yetkiniz yok.", whatever the API said.
 */
export function actionErrorMessage(
  error: { status: number; code: string; message: string },
  messages: Record<string, string> = FAZ6_ERROR_MESSAGES,
): string {
  const known = Object.hasOwn(messages, error.code) ? messages[error.code] : undefined;
  if (known) return known;
  return error.status === 403 ? FORBIDDEN_MESSAGE : error.message;
}
