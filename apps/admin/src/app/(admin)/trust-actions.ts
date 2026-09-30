'use server';

import {
  approveVerificationRequestSchema,
  categoryRequirementRequestSchema,
  liftSuspensionRequestSchema,
  reviewRiskSignalRequestSchema,
  setAdminPermissionsRequestSchema,
  startVerificationReviewRequestSchema,
  suspendProviderRequestSchema,
  uuidSchema,
  verificationDecisionRequestSchema,
} from '@ustago/validation';
import { revalidatePath } from 'next/cache';

import { actionErrorMessage } from '@/lib/action-errors';
import { apiAction } from '@/lib/api';
import { type ActionState, formText, INVALID, isConfirmed, issueMessage } from '@/lib/form-action';
import { istanbulDayStart } from '@/lib/job-filters';

const FIELD_MESSAGES: Record<string, string> = {
  reasonCode: 'Bir gerekçe kodu seçin.',
  userVisibleReason: 'Ustaya gösterilecek açıklama 5–500 karakter olmalı.',
  internalNote: 'İç not en fazla 2000 karakter olabilir.',
  note: 'Not 5–1000 karakter olmalı.',
  expiresAt: 'Kalıcı kapatma süreli olamaz; bitiş tarihini boş bırakın.',
  documentType: 'Bir belge türü seçin.',
  permissions: 'Geçersiz yetki seçimi.',
  status: 'Bir karar seçin.',
};

async function send(
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body: unknown,
  revalidate: string[],
): Promise<ActionState> {
  const result = await apiAction(path, { method, body });
  if (!result.ok) return { error: actionErrorMessage(result) };
  for (const p of revalidate) revalidatePath(p);
  return { ok: true };
}

const providerPaths = (providerId: string) => [
  '/verifications/cases',
  `/verifications/cases/${providerId}`,
  '/providers',
  `/providers/${providerId}`,
  `/providers/${providerId}/360`,
];

// ---------------------------------------------------------------------------
// Doğrulama talepleri
// ---------------------------------------------------------------------------

const CASE_DECISIONS = ['start-review', 'approve', 'request-revision', 'reject'] as const;
type CaseDecision = (typeof CASE_DECISIONS)[number];

/**
 * Every verification decision carries the case version the admin saw; if
 * someone else acted first the API answers 409 VERIFICATION_VERSION_CONFLICT
 * and nothing changes.
 */
export async function decideVerificationCase(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const providerId = uuidSchema.safeParse(form.get('providerId'));
  const decision = formText(form, 'decision') as CaseDecision;
  const versionText = formText(form, 'expectedVersion');
  if (!providerId.success || !CASE_DECISIONS.includes(decision) || !/^\d+$/.test(versionText)) {
    return INVALID;
  }
  const expectedVersion = Number(versionText);
  const internalNote = formText(form, 'internalNote').trim();

  let body: unknown;
  if (decision === 'start-review') {
    body = startVerificationReviewRequestSchema.parse({ expectedVersion });
  } else if (decision === 'approve') {
    const parsed = approveVerificationRequestSchema.safeParse({
      expectedVersion,
      ...(internalNote ? { internalNote } : {}),
    });
    if (!parsed.success) return { error: issueMessage(parsed.error, FIELD_MESSAGES) };
    body = parsed.data;
  } else {
    const rejectDocumentIds = form
      .getAll('rejectDocumentIds')
      .filter((v): v is string => typeof v === 'string');
    const parsed = verificationDecisionRequestSchema.safeParse({
      expectedVersion,
      reasonCode: formText(form, 'reasonCode'),
      userVisibleReason: formText(form, 'userVisibleReason'),
      ...(internalNote ? { internalNote } : {}),
      ...(rejectDocumentIds.length > 0 ? { rejectDocumentIds } : {}),
    });
    if (!parsed.success) return { error: issueMessage(parsed.error, FIELD_MESSAGES) };
    body = parsed.data;
  }
  return send(
    `/admin/verification-cases/${providerId.data}/${decision}`,
    'POST',
    body,
    providerPaths(providerId.data),
  );
}

// ---------------------------------------------------------------------------
// Hesap askıları
// ---------------------------------------------------------------------------

/**
 * Suspend (or permanently close) a provider account. Existing jobs and
 * history stay; new quotes, NOW jobs and payouts stop.
 */
export async function suspendProvider(_prev: ActionState, form: FormData): Promise<ActionState> {
  const providerId = uuidSchema.safeParse(form.get('providerId'));
  if (!providerId.success) return INVALID;
  const expiresOn = formText(form, 'expiresOn');
  if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) {
    return { error: 'Geçerli bir bitiş tarihi girin.' };
  }
  const internalNote = formText(form, 'internalNote').trim();
  const parsed = suspendProviderRequestSchema.safeParse({
    level: formText(form, 'level') || 'SUSPENDED',
    reasonCode: formText(form, 'reasonCode'),
    userVisibleReason: formText(form, 'userVisibleReason'),
    ...(internalNote ? { internalNote } : {}),
    // The chosen day is the last suspended day (Istanbul).
    ...(expiresOn ? { expiresAt: istanbulDayStart(expiresOn, 1) } : {}),
    autoLift: form.get('autoLift') === 'yes',
  });
  if (!parsed.success) return { error: issueMessage(parsed.error, FIELD_MESSAGES) };
  return send(
    `/admin/providers/${providerId.data}/suspensions`,
    'POST',
    parsed.data,
    providerPaths(providerId.data),
  );
}

export async function liftSuspension(_prev: ActionState, form: FormData): Promise<ActionState> {
  const providerId = uuidSchema.safeParse(form.get('providerId'));
  if (!providerId.success) return INVALID;
  const parsed = liftSuspensionRequestSchema.safeParse({ note: formText(form, 'note') });
  if (!parsed.success) return { error: issueMessage(parsed.error, FIELD_MESSAGES) };
  return send(
    `/admin/providers/${providerId.data}/suspensions/lift`,
    'POST',
    parsed.data,
    providerPaths(providerId.data),
  );
}

// ---------------------------------------------------------------------------
// Kategori belge kuralları
// ---------------------------------------------------------------------------

export async function addCategoryRequirement(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const categoryId = uuidSchema.safeParse(form.get('categoryId'));
  if (!categoryId.success) return { error: 'Bir kategori seçin.' };
  const note = formText(form, 'note').trim();
  const parsed = categoryRequirementRequestSchema.safeParse({
    documentType: formText(form, 'documentType'),
    ...(note ? { note } : {}),
  });
  if (!parsed.success) return { error: issueMessage(parsed.error, FIELD_MESSAGES) };
  return send(`/admin/categories/${categoryId.data}/requirements`, 'POST', parsed.data, [
    '/category-requirements',
  ]);
}

export async function removeCategoryRequirement(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = uuidSchema.safeParse(form.get('id'));
  if (!id.success) return INVALID;
  return send(`/admin/category-requirements/${id.data}`, 'DELETE', undefined, [
    '/category-requirements',
  ]);
}

// ---------------------------------------------------------------------------
// Yetkiler ve risk sinyalleri
// ---------------------------------------------------------------------------

/** Replaces an admin's permission grants; the admin must tick the confirm box. */
export async function setAdminPermissions(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const userId = uuidSchema.safeParse(form.get('userId'));
  if (!userId.success) return INVALID;
  if (!isConfirmed(form)) return { error: 'Değişikliği onaylamak için kutuyu işaretleyin.' };
  const permissions = form.getAll('permissions').filter((v): v is string => typeof v === 'string');
  const parsed = setAdminPermissionsRequestSchema.safeParse({ permissions, confirm: true });
  if (!parsed.success) return { error: issueMessage(parsed.error, FIELD_MESSAGES) };
  return send(`/admin/users/${userId.data}/permissions`, 'PUT', parsed.data, ['/permissions']);
}

/** Marks a risk signal reviewed or dismissed; it never acts on the account. */
export async function reviewRiskSignal(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = uuidSchema.safeParse(form.get('id'));
  if (!id.success) return INVALID;
  const parsed = reviewRiskSignalRequestSchema.safeParse({
    status: formText(form, 'status'),
    note: formText(form, 'note'),
  });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.path[0] === 'note'
          ? 'Not 3–1000 karakter olmalı.'
          : issueMessage(parsed.error, FIELD_MESSAGES),
    };
  }
  return send(`/admin/risk-signals/${id.data}/review`, 'POST', parsed.data, ['/security']);
}
