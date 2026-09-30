import type {
  ProviderAccountStatus,
  ProviderVerification,
  ProviderVerificationCaseView,
  ProviderVerificationStatus,
  VerificationDocumentRequirement,
} from '@ustago/types';

import type { Tone } from './theme';

type Label = { label: string; tone: Tone };

/** The account verification case ("Hesabımı Doğrula"), as the provider reads it. */
export const VERIFICATION_STATUS: Record<ProviderVerificationStatus, Label> = {
  NOT_STARTED: { label: 'Doğrulanmadı', tone: 'neutral' },
  IN_PROGRESS: { label: 'Hazırlanıyor', tone: 'info' },
  SUBMITTED: { label: 'Gönderildi', tone: 'warning' },
  UNDER_REVIEW: { label: 'İnceleniyor', tone: 'warning' },
  NEEDS_REVISION: { label: 'Düzeltme istendi', tone: 'danger' },
  VERIFIED: { label: 'Doğrulandı', tone: 'success' },
  REJECTED: { label: 'Reddedildi', tone: 'danger' },
  SUSPENDED: { label: 'Askıda', tone: 'danger' },
};

export const ACCOUNT_STATUS: Record<ProviderAccountStatus, Label> = {
  ACTIVE: { label: 'Hesap aktif', tone: 'success' },
  LIMITED: { label: 'Hesap kısıtlı', tone: 'warning' },
  SUSPENDED: { label: 'Hesap askıda', tone: 'danger' },
  BANNED: { label: 'Hesap kapatıldı', tone: 'danger' },
};

/** Shown on the provider's own profile and the public one ("not a quality guarantee"). */
export const VERIFIED_BADGE_LABEL = '✓ Kimliği/hesabı doğrulanmıştır';

/** One document on file, in a few words. */
export function documentStateLabel(doc: ProviderVerification | null): Label {
  if (!doc) return { label: 'Yüklenmedi', tone: 'neutral' };
  switch (doc.status) {
    case 'PENDING':
      return { label: 'İnceleniyor', tone: 'warning' };
    case 'APPROVED':
      return { label: 'Onaylandı', tone: 'success' };
    case 'REJECTED':
      return { label: 'Reddedildi', tone: 'danger' };
    case 'EXPIRED':
      return { label: 'Süresi doldu', tone: 'neutral' };
  }
}

/** A required document counts once it is waiting for review or approved. */
export function documentSatisfied(req: VerificationDocumentRequirement): boolean {
  const s = req.current?.status;
  return s === 'PENDING' || s === 'APPROVED';
}

export function identityRequirement(
  view: ProviderVerificationCaseView,
): VerificationDocumentRequirement | null {
  return view.documents.find((d) => d.type === 'IDENTITY') ?? null;
}

/** Category documents and optional extras: everything but the identity document. */
export function extraRequirements(
  view: ProviderVerificationCaseView,
): VerificationDocumentRequirement[] {
  return view.documents.filter((d) => d.type !== 'IDENTITY');
}

/** Documents the reviewer rejected and the provider has not replaced yet. */
export function rejectedDocuments(
  view: ProviderVerificationCaseView,
): VerificationDocumentRequirement[] {
  return view.documents.filter((d) => d.current?.status === 'REJECTED');
}

/* ---------------------------------------------------------------- steps */

export const VERIFICATION_STEPS = [
  { key: 'INTRO', title: 'Neler gerekli?' },
  { key: 'IDENTITY', title: 'Kimlik belgesi' },
  { key: 'EXTRA', title: 'Ek belgeler' },
  { key: 'REVIEW', title: 'Kontrol et' },
  { key: 'STATUS', title: 'Durum' },
] as const;

export type VerificationStep = 1 | 2 | 3 | 4 | 5;
export const LAST_STEP: VerificationStep = 5;

/** Statuses where the case is with the review team or already decided positively. */
const SENT: readonly ProviderVerificationStatus[] = ['SUBMITTED', 'UNDER_REVIEW', 'VERIFIED'];

/** Where the flow opens: the status page once the case is sent, else the start. */
export function initialStep(view: ProviderVerificationCaseView): VerificationStep {
  if (SENT.includes(view.status)) return 5;
  if (view.status === 'SUSPENDED' || !view.canEditDocuments) return 5;
  return 1;
}

/**
 * Whether "Devam" is allowed on a step. Identity must be on file before
 * the extras, and every required document before the review.
 */
export function canContinue(step: VerificationStep, view: ProviderVerificationCaseView): boolean {
  switch (step) {
    case 1:
      return view.canEditDocuments;
    case 2: {
      const id = identityRequirement(view);
      return id === null || !id.required || documentSatisfied(id);
    }
    case 3:
      return view.documents.filter((d) => d.required).every(documentSatisfied);
    case 4:
      return view.canSubmit;
    case 5:
      return false;
  }
}

/** The previous step, or null on the first step and on the status page. */
export function previousStep(step: VerificationStep): VerificationStep | null {
  if (step === 1 || step === 5) return null;
  return (step - 1) as VerificationStep;
}

export function nextStep(step: VerificationStep): VerificationStep {
  return (step === LAST_STEP ? LAST_STEP : step + 1) as VerificationStep;
}

/** Profile, services and areas are edited in the application screen, not here. */
export function missingBasics(view: ProviderVerificationCaseView): string[] {
  return view.checklist
    .filter((c) => !c.done && c.key !== 'DOCUMENTS' && c.key !== 'SUBMIT')
    .map((c) => c.label);
}

/* --------------------------------------------------------- account state */

export interface AccountNotice {
  tone: Tone;
  title: string;
  body: string;
  reason: string | null;
  until: string | null;
}

/** The banner shown while the account is limited, suspended or closed; null while active. */
export function accountNotice(view: ProviderVerificationCaseView): AccountNotice | null {
  const s = view.activeSuspension;
  const reason = s?.userVisibleReason ?? null;
  const until = s?.expiresAt ?? null;
  switch (view.accountStatus) {
    case 'ACTIVE':
      return null;
    case 'LIMITED':
      return {
        tone: 'warning',
        title: 'Hesabınız kısıtlandı',
        body: 'Bazı işlemler geçici olarak kapalı. Mevcut işlerinizi tamamlayabilirsiniz.',
        reason,
        until,
      };
    case 'SUSPENDED':
      return {
        tone: 'danger',
        title: 'Hesabınız askıya alındı',
        body: 'Bu sürede yeni işlere teklif veremez ve acil iş alamazsınız; profiliniz aramalarda görünmez. Devam eden işlerinizi tamamlayabilirsiniz.',
        reason,
        until,
      };
    case 'BANNED':
      return {
        tone: 'danger',
        title: 'Hesabınız kapatıldı',
        body: 'Bu hesapla yeni iş alamazsınız. İtiraz için destek ekibimizle iletişime geçin.',
        reason,
        until: null,
      };
  }
}

/* ---------------------------------------------------------------- upload */

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;

/** A user-facing reason the file cannot be sent, or null when it is fine. */
export function documentFileError(
  mimeType: string | null | undefined,
  size: number,
): string | null {
  if (!mimeType || !(DOCUMENT_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return 'Yalnızca JPEG, PNG veya PDF yükleyebilirsiniz.';
  }
  if (size <= 0) return 'Dosya boş görünüyor. Lütfen başka bir dosya seçin.';
  if (size > MAX_DOCUMENT_BYTES) return 'Dosya en fazla 10 MB olabilir.';
  return null;
}

export type UploadStage = 'idle' | 'preparing' | 'uploading' | 'confirming' | 'done' | 'failed';

/** Progress bar value (0-1) and caption for each upload stage. */
export function uploadProgress(stage: UploadStage): { value: number; label: string } {
  switch (stage) {
    case 'idle':
      return { value: 0, label: '' };
    case 'preparing':
      return { value: 0.15, label: 'Hazırlanıyor…' };
    case 'uploading':
      return { value: 0.55, label: 'Dosya gönderiliyor…' };
    case 'confirming':
      return { value: 0.9, label: 'Kaydediliyor…' };
    case 'done':
      return { value: 1, label: 'Yüklendi' };
    case 'failed':
      return { value: 0, label: 'Yükleme başarısız' };
  }
}
