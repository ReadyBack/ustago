'use server';

import {
  createFeePolicyRequestSchema,
  resolveAlertRequestSchema,
  setRuntimeFlagRequestSchema,
  uuidSchema,
} from '@ustago/validation';
import { revalidatePath } from 'next/cache';

import { actionErrorMessage } from '@/lib/action-errors';
import { apiAction } from '@/lib/api';
import { type ActionState, formText, INVALID, isConfirmed, issueMessage } from '@/lib/form-action';
import { istanbulLocalToIso, parsePercentToBps } from '@/lib/trust-filters';

const FIELD_MESSAGES: Record<string, string> = {
  code: 'Kod 3–60 karakter; küçük harf, rakam ve tire içermeli (ör. standart-2026-10).',
  name: 'Ad 3–120 karakter olmalı.',
  bps: 'Oran %0 ile %50 arasında olmalı.',
  effectiveFrom: 'Geçerli bir başlangıç zamanı girin.',
  note: 'Not 5–1000 karakter olmalı.',
  reason: 'Gerekçe 5–500 karakter olmalı.',
};

const CONFIRM_REQUIRED = { error: 'İşlemi onaylamak için kutuyu işaretleyin.' };

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

// ---------------------------------------------------------------------------
// Komisyon politikaları
// ---------------------------------------------------------------------------

/** A new DRAFT policy; it applies to nothing until it is published. */
export async function createFeePolicy(_prev: ActionState, form: FormData): Promise<ActionState> {
  const bps = parsePercentToBps(formText(form, 'rate'));
  if (bps === null) return { error: 'Oranı yüzde olarak girin (ör. 10 veya 12,5; en fazla %50).' };
  const effectiveFrom = istanbulLocalToIso(formText(form, 'effectiveFrom'));
  if (effectiveFrom === null) return { error: 'Geçerli bir başlangıç zamanı girin.' };
  const parsed = createFeePolicyRequestSchema.safeParse({
    code: formText(form, 'code'),
    name: formText(form, 'name'),
    bps,
    effectiveFrom,
  });
  if (!parsed.success) return { error: issueMessage(parsed.error, FIELD_MESSAGES) };
  return send('/admin/fee-policies', 'POST', parsed.data, ['/fee-policies']);
}

const POLICY_DECISIONS = ['publish', 'retire', 'delete'] as const;

/**
 * Publish (freezes the policy), retire (cancel a SCHEDULED one) or delete a
 * draft. Publish and retire need the explicit confirm checkbox; the API
 * refuses to delete anything but a draft.
 */
export async function decideFeePolicy(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = uuidSchema.safeParse(form.get('id'));
  const decision = formText(form, 'decision') as (typeof POLICY_DECISIONS)[number];
  if (!id.success || !POLICY_DECISIONS.includes(decision)) return INVALID;
  if (decision !== 'delete' && !isConfirmed(form)) return CONFIRM_REQUIRED;
  if (decision === 'delete') {
    return send(`/admin/fee-policies/${id.data}`, 'DELETE', undefined, ['/fee-policies']);
  }
  return send(`/admin/fee-policies/${id.data}/${decision}`, 'POST', { confirm: true }, [
    '/fee-policies',
  ]);
}

// ---------------------------------------------------------------------------
// Uyarılar
// ---------------------------------------------------------------------------

export async function acknowledgeAlert(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = uuidSchema.safeParse(form.get('id'));
  if (!id.success) return INVALID;
  return send(`/admin/alerts/${id.data}/acknowledge`, 'POST', undefined, [
    '/operations',
    '/operations/alerts',
  ]);
}

/** Closes an alert with a note. It never changes a finance record. */
export async function resolveAlert(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = uuidSchema.safeParse(form.get('id'));
  if (!id.success) return INVALID;
  const parsed = resolveAlertRequestSchema.safeParse({ note: formText(form, 'note') });
  if (!parsed.success) return { error: issueMessage(parsed.error, FIELD_MESSAGES) };
  return send(`/admin/alerts/${id.data}/resolve`, 'POST', parsed.data, [
    '/operations',
    '/operations/alerts',
  ]);
}

// ---------------------------------------------------------------------------
// İzleyici, mutabakat, özellik anahtarları
// ---------------------------------------------------------------------------

export async function runOpsMonitor(_prev: ActionState): Promise<ActionState> {
  return send('/admin/ops/monitor/run', 'POST', undefined, ['/operations', '/operations/alerts']);
}

/** Runs reconciliation now and records it. It reports; it never fixes anything. */
export async function runReconciliation(_prev: ActionState): Promise<ActionState> {
  return send('/admin/finance/reconciliation/runs', 'POST', undefined, [
    '/operations',
    '/operations/reconciliation',
    '/operations/alerts',
  ]);
}

/** Admin kill switch: turns a feature off (or back on) with a reason and a confirmation. */
export async function setRuntimeFlag(_prev: ActionState, form: FormData): Promise<ActionState> {
  const key = formText(form, 'key');
  const enabled = formText(form, 'enabled');
  if (!/^[a-z_]{2,40}$/.test(key) || (enabled !== 'true' && enabled !== 'false')) return INVALID;
  if (!isConfirmed(form)) return CONFIRM_REQUIRED;
  const parsed = setRuntimeFlagRequestSchema.safeParse({
    enabled: enabled === 'true',
    reason: formText(form, 'reason'),
    confirm: true,
  });
  if (!parsed.success) return { error: issueMessage(parsed.error, FIELD_MESSAGES) };
  return send(`/admin/runtime-flags/${key}`, 'PUT', parsed.data, ['/operations']);
}
