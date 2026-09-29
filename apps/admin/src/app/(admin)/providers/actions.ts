'use server';

import { reviewReasonRequestSchema, uuidSchema } from '@ustago/validation';
import { revalidatePath } from 'next/cache';

import { apiAction } from '@/lib/api';

export interface ReviewState {
  ok?: boolean;
  error?: string;
}

type Target = 'provider' | 'verification';
type Decision = 'approve' | 'reject' | 'suspend' | 'reinstate';

const NEEDS_REASON: ReadonlySet<Decision> = new Set(['reject', 'suspend']);
const ALLOWED: Record<Target, ReadonlySet<Decision>> = {
  provider: new Set(['approve', 'reject', 'suspend', 'reinstate']),
  verification: new Set(['approve', 'reject']),
};

const MESSAGES: Record<string, string> = {
  VERIFICATION_REQUIRED: 'Önce zorunlu belgeleri onaylayın.',
  VERIFICATION_ALREADY_REVIEWED: 'Bu belge başka bir yönetici tarafından zaten incelendi.',
  INVALID_PROVIDER_STATE: 'Başvurunun durumu değişmiş; sayfayı yenileyin.',
  CANNOT_REVIEW_SELF: 'Kendi başvurunuzu inceleyemezsiniz.',
  PROVIDER_PROFILE_INCOMPLETE: 'Başvuruda eksik adımlar var.',
};

/**
 * One Server Action for every review button. The form names the target,
 * id and decision; all three are validated here and the API enforces the
 * real rules (roles, state machine, first reviewer wins).
 */
export async function review(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const target = formData.get('target');
  const decision = formData.get('decision');
  const id = uuidSchema.safeParse(formData.get('id'));
  if (
    (target !== 'provider' && target !== 'verification') ||
    typeof decision !== 'string' ||
    !ALLOWED[target].has(decision as Decision) ||
    !id.success
  ) {
    return { error: 'Geçersiz istek.' };
  }

  let body: { reason: string } | undefined;
  if (NEEDS_REASON.has(decision as Decision)) {
    const reason = reviewReasonRequestSchema.safeParse({ reason: formData.get('reason') ?? '' });
    if (!reason.success) return { error: 'Sebep en az 5 karakter olmalı.' };
    body = reason.data;
  }

  const path =
    target === 'provider'
      ? `/admin/providers/${id.data}/${decision}`
      : `/admin/provider-verifications/${id.data}/${decision}`;
  const result = await apiAction(path, { method: 'POST', body: body ?? {} });
  if (!result.ok) return { error: MESSAGES[result.code] ?? result.message };

  const providerId = formData.get('providerId');
  if (typeof providerId === 'string') revalidatePath(`/providers/${providerId}`);
  revalidatePath('/providers');
  revalidatePath('/verifications');
  return { ok: true };
}
