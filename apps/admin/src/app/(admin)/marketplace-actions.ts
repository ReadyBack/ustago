'use server';

import {
  requestPhotoPolicySchema,
  resolveMessageReportSchema,
  updateProvinceRequestSchema,
  uuidSchema,
} from '@ustago/validation';
import type { AdminReportedConversation } from '@ustago/types';
import { revalidatePath } from 'next/cache';

import { actionErrorMessage } from '@/lib/action-errors';
import { apiAction } from '@/lib/api';
import {
  aliasError,
  buildCreateQuestionPayload,
  buildUpdateQuestionPayload,
  parseDraft,
} from '@/lib/category-content';
import { type ActionState, formText, INVALID, isConfirmed } from '@/lib/form-action';
import { isLaunchStatus, launchStatusPayload } from '@/lib/marketplace';
import { adminReportedConversationSchema } from '@/lib/marketplace-schemas';
import { accessReasonError } from '@/lib/message-reports';

async function send(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown,
  revalidate: string[],
): Promise<ActionState> {
  const result = await apiAction(path, { method, body });
  if (!result.ok) return { error: actionErrorMessage(result) };
  for (const p of revalidate) revalidatePath(p);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// İl açılış durumu
// ---------------------------------------------------------------------------

/** ACTIVE / WAITLIST / DISABLED → PATCH /locations/provinces/:id; needs the confirm box. */
export async function setProvinceLaunchStatus(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const idText = formText(form, 'provinceId');
  const status = formText(form, 'launchStatus');
  if (!/^\d{1,2}$/.test(idText) || !isLaunchStatus(status)) return INVALID;
  const provinceId = Number(idText);
  if (provinceId < 1 || provinceId > 81) return INVALID;
  if (!isConfirmed(form)) return { error: 'Değişikliği onaylayın.' };
  const body = updateProvinceRequestSchema.parse(launchStatusPayload(status));
  return send(`/locations/provinces/${provinceId}`, 'PATCH', body, [
    '/marketplace/provinces',
    '/marketplace/regions',
  ]);
}

// ---------------------------------------------------------------------------
// Kategori içeriği: sorular, eş anlamlılar, fotoğraf politikası
// ---------------------------------------------------------------------------

const categoryPath = (id: string) => [`/categories/${id}`];

export async function createCategoryQuestion(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const categoryId = uuidSchema.safeParse(form.get('categoryId'));
  const draft = parseDraft(formText(form, 'draft'));
  if (!categoryId.success || !draft) return INVALID;
  const payload = buildCreateQuestionPayload(draft);
  if (!payload.ok) return { error: payload.error };
  return send(
    `/admin/categories/${categoryId.data}/questions`,
    'POST',
    payload.body,
    categoryPath(categoryId.data),
  );
}

export async function updateCategoryQuestion(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const categoryId = uuidSchema.safeParse(form.get('categoryId'));
  const questionId = uuidSchema.safeParse(form.get('questionId'));
  const draft = parseDraft(formText(form, 'draft'));
  if (!categoryId.success || !questionId.success || !draft) return INVALID;
  const payload = buildUpdateQuestionPayload(draft);
  if (!payload.ok) return { error: payload.error };
  return send(
    `/admin/category-questions/${questionId.data}`,
    'PATCH',
    payload.body,
    categoryPath(categoryId.data),
  );
}

/** No delete: a question is only switched off (`isActive: false`) or back on. */
export async function setCategoryQuestionActive(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const categoryId = uuidSchema.safeParse(form.get('categoryId'));
  const questionId = uuidSchema.safeParse(form.get('questionId'));
  const active = formText(form, 'isActive');
  if (!categoryId.success || !questionId.success || !['true', 'false'].includes(active)) {
    return INVALID;
  }
  return send(
    `/admin/category-questions/${questionId.data}`,
    'PATCH',
    { isActive: active === 'true' },
    categoryPath(categoryId.data),
  );
}

export async function addCategoryAlias(_prev: ActionState, form: FormData): Promise<ActionState> {
  const categoryId = uuidSchema.safeParse(form.get('categoryId'));
  if (!categoryId.success) return INVALID;
  const alias = formText(form, 'alias').trim();
  const error = aliasError(alias);
  if (error) return { error };
  return send(
    `/admin/categories/${categoryId.data}/aliases`,
    'POST',
    { alias },
    categoryPath(categoryId.data),
  );
}

export async function removeCategoryAlias(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const categoryId = uuidSchema.safeParse(form.get('categoryId'));
  const aliasId = uuidSchema.safeParse(form.get('aliasId'));
  if (!categoryId.success || !aliasId.success) return INVALID;
  return send(
    `/admin/category-aliases/${aliasId.data}`,
    'DELETE',
    undefined,
    categoryPath(categoryId.data),
  );
}

export async function setCategoryPhotoPolicy(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const categoryId = uuidSchema.safeParse(form.get('categoryId'));
  const policy = requestPhotoPolicySchema.safeParse(form.get('requestPhotoPolicy'));
  if (!categoryId.success) return INVALID;
  if (!policy.success) return { error: 'Bir fotoğraf politikası seçin.' };
  return send(
    `/categories/${categoryId.data}`,
    'PATCH',
    { requestPhotoPolicy: policy.data },
    categoryPath(categoryId.data),
  );
}

// ---------------------------------------------------------------------------
// Mesaj şikayetleri
// ---------------------------------------------------------------------------

export interface AccessState extends ActionState {
  conversation?: AdminReportedConversation;
}

/**
 * Opens a reported conversation with a written reason. The API writes an
 * audit record; the messages come back only in this action's response and
 * are never cached (apiRequest uses `cache: 'no-store'`, nothing is
 * revalidated or stored).
 */
export async function accessReportedConversation(
  _prev: AccessState,
  form: FormData,
): Promise<AccessState> {
  const reportId = uuidSchema.safeParse(form.get('reportId'));
  if (!reportId.success) return INVALID;
  const reason = formText(form, 'reason');
  const error = accessReasonError(reason);
  if (error) return { error };
  const result = await apiAction(`/admin/message-reports/${reportId.data}/access`, {
    method: 'POST',
    body: { reason: reason.trim() },
    schema: adminReportedConversationSchema,
  });
  if (!result.ok) return { error: actionErrorMessage(result) };
  return { ok: true, conversation: result.data };
}

export async function resolveMessageReport(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const reportId = uuidSchema.safeParse(form.get('reportId'));
  if (!reportId.success) return INVALID;
  const parsed = resolveMessageReportSchema.safeParse({
    status: formText(form, 'status'),
    note: formText(form, 'note'),
  });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.path[0] === 'status'
          ? 'Bir karar seçin.'
          : 'Not 3–500 karakter olmalı.',
    };
  }
  return send(`/admin/message-reports/${reportId.data}/resolve`, 'POST', parsed.data, [
    '/message-reports',
  ]);
}
