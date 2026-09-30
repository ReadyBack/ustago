'use server';

import {
  createPenaltySchema,
  moderateReviewSchema,
  resolveDisputeSchema,
  revokePenaltySchema,
  uuidSchema,
} from '@ustago/validation';
import { revalidatePath } from 'next/cache';

import { apiAction } from '@/lib/api';
import { istanbulDayStart } from '@/lib/job-filters';

export interface ModerationState {
  ok?: boolean;
  error?: string;
}

const MESSAGES: Record<string, string> = {
  DISPUTE_ALREADY_RESOLVED:
    'Bu sorun bildirimi başka bir yönetici tarafından zaten sonuçlandırıldı.',
  DISPUTE_NOT_FOUND: 'Sorun bildirimi bulunamadı.',
  REVIEW_MODERATION_CONFLICT: 'Değerlendirmenin durumu değişmiş; sayfayı yenileyin.',
  REVIEW_NOT_FOUND: 'Değerlendirme bulunamadı.',
  PENALTY_NOT_ACTIVE: 'Bu yaptırım artık yürürlükte değil.',
  PENALTY_NOT_FOUND: 'Yaptırım bulunamadı.',
  PENALTY_INVALID_WINDOW: 'Bitiş tarihi bugünden sonra olmalı.',
  PROVIDER_NOT_FOUND: 'Usta bulunamadı.',
};

const INVALID = { error: 'Geçersiz istek.' };
const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
};

function firstIssue(error: { issues: readonly { message: string }[] }): string {
  return error.issues[0]?.message ?? 'Geçersiz istek.';
}

async function send(path: string, body: unknown, revalidate: string[]): Promise<ModerationState> {
  const result = await apiAction(path, { method: 'POST', body });
  if (!result.ok) return { error: MESSAGES[result.code] ?? result.message };
  for (const p of revalidate) revalidatePath(p);
  return { ok: true };
}

/** Resolve a dispute with an outcome and a note (the job stays DISPUTED). */
export async function resolveDispute(
  _prev: ModerationState,
  form: FormData,
): Promise<ModerationState> {
  const id = uuidSchema.safeParse(form.get('id'));
  if (!id.success) return INVALID;
  const body = resolveDisputeSchema.safeParse({
    outcome: text(form, 'outcome'),
    note: text(form, 'note'),
  });
  if (!body.success) return { error: firstIssue(body.error) };
  return send(`/admin/disputes/${id.data}/resolve`, body.data, [
    '/disputes',
    `/disputes/${id.data}`,
    '/jobs',
  ]);
}

/** Hide or restore a review; hidden reviews leave the public profile and the average. */
export async function moderateReview(
  _prev: ModerationState,
  form: FormData,
): Promise<ModerationState> {
  const id = uuidSchema.safeParse(form.get('id'));
  const decision = form.get('decision');
  if (!id.success || (decision !== 'hide' && decision !== 'restore')) return INVALID;
  const body = moderateReviewSchema.safeParse({ reason: text(form, 'reason') });
  if (!body.success) return { error: firstIssue(body.error) };
  return send(`/admin/reviews/${id.data}/${decision}`, body.data, ['/reviews']);
}

/** An admin-decided sanction from the provider's quality card. */
export async function createPenalty(
  _prev: ModerationState,
  form: FormData,
): Promise<ModerationState> {
  const providerId = uuidSchema.safeParse(form.get('providerId'));
  if (!providerId.success) return INVALID;
  const endsOn = text(form, 'endsOn');
  const body = createPenaltySchema.safeParse({
    type: text(form, 'type'),
    reasonCode: text(form, 'reasonCode').toUpperCase(),
    reason: text(form, 'reason'),
    endsAt: /^\d{4}-\d{2}-\d{2}$/.test(endsOn) ? istanbulDayStart(endsOn, 1) : null,
  });
  if (!body.success) return { error: firstIssue(body.error) };
  return send(`/admin/providers/${providerId.data}/penalties`, body.data, [
    `/providers/${providerId.data}`,
  ]);
}

export async function revokePenalty(
  _prev: ModerationState,
  form: FormData,
): Promise<ModerationState> {
  const id = uuidSchema.safeParse(form.get('id'));
  const providerId = uuidSchema.safeParse(form.get('providerId'));
  if (!id.success || !providerId.success) return INVALID;
  const body = revokePenaltySchema.safeParse({ reason: text(form, 'reason') });
  if (!body.success) return { error: firstIssue(body.error) };
  return send(`/admin/penalties/${id.data}/revoke`, body.data, [`/providers/${providerId.data}`]);
}
