import type { CategoryAnswerSnapshot, CategoryQuestionType } from '@ustago/types';

/**
 * Validates a request's answers against the category's live questions and
 * builds the snapshot stored on the request (docs/adr/0028). Pure.
 * (Placeholder until the category-content work lands; same signature.)
 */
export interface CategoryQuestionRow {
  id: string;
  key: string;
  label: string;
  type: CategoryQuestionType;
  options: unknown;
  required: boolean;
  minValue: number | null;
  maxValue: number | null;
  isActive: boolean;
}

type Result =
  | { ok: true; snapshot: CategoryAnswerSnapshot[] }
  | { ok: false; errors: { key: string; message: string }[] };

function optionsOf(q: CategoryQuestionRow): { value: string; label: string }[] {
  return Array.isArray(q.options)
    ? q.options.filter(
        (o): o is { value: string; label: string } =>
          typeof o === 'object' && o !== null && typeof (o as { value?: unknown }).value === 'string',
      )
    : [];
}

export function validateCategoryAnswers(
  questions: readonly CategoryQuestionRow[],
  answers: Record<string, unknown> | undefined,
): Result {
  const given = answers ?? {};
  const live = questions.filter((q) => q.isActive);
  const byKey = new Map(live.map((q) => [q.key, q]));
  const errors: { key: string; message: string }[] = [];
  for (const key of Object.keys(given)) {
    if (!byKey.has(key)) errors.push({ key, message: 'Bilinmeyen soru.' });
  }
  const snapshot: CategoryAnswerSnapshot[] = [];
  for (const q of live) {
    const v = given[q.key];
    if (v === undefined || v === null || v === '') {
      if (q.required) errors.push({ key: q.key, message: 'Bu soru zorunlu.' });
      continue;
    }
    const opts = optionsOf(q);
    const label = (value: string) => opts.find((o) => o.value === value)?.label;
    switch (q.type) {
      case 'SINGLE_SELECT': {
        const l = typeof v === 'string' ? label(v) : undefined;
        if (typeof v !== 'string' || !l) errors.push({ key: q.key, message: 'Geçersiz seçim.' });
        else snapshot.push({ questionId: q.id, key: q.key, label: q.label, type: q.type, value: v, displayValue: l });
        break;
      }
      case 'MULTI_SELECT': {
        const arr = Array.isArray(v) ? v : null;
        const labels = arr?.map((x) => (typeof x === 'string' ? label(x) : undefined));
        if (!arr || arr.length === 0 || !labels || labels.some((l) => !l) || new Set(arr).size !== arr.length) {
          errors.push({ key: q.key, message: 'Geçersiz seçim.' });
        } else {
          snapshot.push({
            questionId: q.id,
            key: q.key,
            label: q.label,
            type: q.type,
            value: arr as string[],
            displayValue: labels.join(', '),
          });
        }
        break;
      }
      case 'BOOLEAN':
        if (typeof v !== 'boolean') errors.push({ key: q.key, message: 'Evet ya da hayır seçin.' });
        else snapshot.push({ questionId: q.id, key: q.key, label: q.label, type: q.type, value: v, displayValue: v ? 'Evet' : 'Hayır' });
        break;
      case 'NUMBER':
        if (
          typeof v !== 'number' ||
          !Number.isFinite(v) ||
          (q.minValue !== null && v < q.minValue) ||
          (q.maxValue !== null && v > q.maxValue)
        ) {
          errors.push({ key: q.key, message: 'Geçersiz sayı.' });
        } else {
          snapshot.push({ questionId: q.id, key: q.key, label: q.label, type: q.type, value: v, displayValue: String(v) });
        }
        break;
      case 'SHORT_TEXT':
        if (typeof v !== 'string' || v.trim().length === 0 || v.length > 200) {
          errors.push({ key: q.key, message: 'Geçersiz metin.' });
        } else {
          snapshot.push({ questionId: q.id, key: q.key, label: q.label, type: q.type, value: v.trim(), displayValue: v.trim() });
        }
        break;
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, snapshot };
}
