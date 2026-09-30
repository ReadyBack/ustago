import type {
  CategoryAnswerSnapshot,
  CategoryQuestionOption,
  CategoryQuestionType,
} from '@ustago/types';

/**
 * Validates a request's answers against the category's live questions
 * (Faz 7, docs/adr/0028) and builds the snapshot stored with the request.
 * Pure: the caller loads the questions. Inactive questions are ignored
 * (their keys count as unknown). Rules:
 *
 * - every key must be an active question of the category (unknown → error)
 * - required questions must be answered
 * - SINGLE_SELECT: one of the option values
 * - MULTI_SELECT: a non-empty list of distinct option values
 * - BOOLEAN: true / false
 * - SHORT_TEXT: 1-200 characters of plain text (no < or >)
 * - NUMBER: a finite number within [minValue, maxValue] when set
 *
 * Snapshots follow the question order (sortOrder, then key) and carry the
 * label and a human-readable value, so later question edits never change
 * a published request. Errors are `{ key, code, message }` (message in
 * Turkish, safe to show).
 */
/**
 * The Prisma `CategoryQuestion` row shape (a row from
 * `prisma.categoryQuestion.findMany()` fits as is). `options` is the stored
 * JSON; a mapped `CategoryQuestion` (options as an array) fits too.
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
  sortOrder?: number;
}

export type CategoryAnswerErrorCode =
  | 'UNKNOWN_QUESTION'
  | 'REQUIRED'
  | 'INVALID_TYPE'
  | 'INVALID_OPTION'
  | 'OUT_OF_RANGE'
  | 'INVALID_TEXT';

export interface CategoryAnswerError {
  key: string;
  code: CategoryAnswerErrorCode;
  message: string;
}

export type CategoryAnswersResult =
  { ok: true; snapshot: CategoryAnswerSnapshot[] } | { ok: false; errors: CategoryAnswerError[] };

export const SHORT_TEXT_MAX = 200;

const collator = new Intl.Collator('tr');

function formatNumber(value: number): string {
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(value);
}

interface ParsedQuestion extends Omit<CategoryQuestionRow, 'options'> {
  options: CategoryQuestionOption[];
}

export function validateCategoryAnswers(
  questions: readonly CategoryQuestionRow[],
  answers: Readonly<Record<string, unknown>> | null | undefined,
): CategoryAnswersResult {
  const active: ParsedQuestion[] = questions
    .filter((q) => q.isActive)
    .map((q) => ({ ...q, options: parseQuestionOptions(q.options) }))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || collator.compare(a.key, b.key));
  const byKey = new Map(active.map((q) => [q.key, q]));
  const given = answers ?? {};
  const errors: CategoryAnswerError[] = [];
  const snapshots: CategoryAnswerSnapshot[] = [];

  for (const key of Object.keys(given)) {
    if (!byKey.has(key)) {
      errors.push({ key, code: 'UNKNOWN_QUESTION', message: 'Bu kategoride böyle bir soru yok.' });
    }
  }

  for (const q of active) {
    const raw = Object.prototype.hasOwnProperty.call(given, q.key) ? given[q.key] : undefined;
    const missing =
      raw === undefined ||
      raw === null ||
      (typeof raw === 'string' && raw.trim() === '') ||
      (Array.isArray(raw) && raw.length === 0);
    if (missing) {
      if (q.required) {
        errors.push({ key: q.key, code: 'REQUIRED', message: `"${q.label}" sorusu zorunlu.` });
      }
      continue;
    }
    const result = checkOne(q, raw);
    if ('error' in result) {
      errors.push({ key: q.key, ...result.error });
      continue;
    }
    snapshots.push({
      questionId: q.id,
      key: q.key,
      label: q.label,
      type: q.type,
      value: result.value,
      displayValue: result.displayValue,
    });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, snapshot: snapshots };
}

type CheckResult =
  | { value: CategoryAnswerSnapshot['value']; displayValue: string }
  | { error: { code: CategoryAnswerErrorCode; message: string } };

const typeError = (message: string): CheckResult => ({
  error: { code: 'INVALID_TYPE', message },
});

function checkOne(q: ParsedQuestion, raw: unknown): CheckResult {
  const optionLabel = (value: string) => q.options.find((o) => o.value === value)?.label;
  switch (q.type) {
    case 'SINGLE_SELECT': {
      if (typeof raw !== 'string') return typeError('Bir seçenek seçin.');
      const label = optionLabel(raw);
      if (label === undefined) {
        return { error: { code: 'INVALID_OPTION', message: 'Geçersiz seçenek.' } };
      }
      return { value: raw, displayValue: label };
    }
    case 'MULTI_SELECT': {
      if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string')) {
        return typeError('Bir veya daha fazla seçenek seçin.');
      }
      const values = raw as string[];
      if (new Set(values).size !== values.length) {
        return { error: { code: 'INVALID_OPTION', message: 'Aynı seçenek iki kez seçilmiş.' } };
      }
      const labels = values.map(optionLabel);
      if (labels.some((l) => l === undefined)) {
        return { error: { code: 'INVALID_OPTION', message: 'Geçersiz seçenek.' } };
      }
      // Stored in the question's option order, whatever order they came in.
      const order = new Map(q.options.map((o, i) => [o.value, i]));
      const sorted = [...values].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
      return {
        value: sorted,
        displayValue: sorted.map((v) => optionLabel(v) ?? v).join(', '),
      };
    }
    case 'BOOLEAN': {
      if (typeof raw !== 'boolean') return typeError('Evet veya Hayır seçin.');
      return { value: raw, displayValue: raw ? 'Evet' : 'Hayır' };
    }
    case 'SHORT_TEXT': {
      if (typeof raw !== 'string') return typeError('Kısa bir metin yazın.');
      const text = raw.trim().replace(/\s+/g, ' ');
      if (text.length > SHORT_TEXT_MAX || /[<>]/.test(text)) {
        return {
          error: {
            code: 'INVALID_TEXT',
            message: `En fazla ${SHORT_TEXT_MAX} karakter; < ve > kullanılamaz.`,
          },
        };
      }
      return { value: text, displayValue: text };
    }
    case 'NUMBER': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return typeError('Bir sayı girin.');
      if ((q.minValue !== null && raw < q.minValue) || (q.maxValue !== null && raw > q.maxValue)) {
        return {
          error: {
            code: 'OUT_OF_RANGE',
            message:
              q.minValue !== null && q.maxValue !== null
                ? `${q.minValue} ile ${q.maxValue} arasında bir değer girin.`
                : q.minValue !== null
                  ? `En az ${q.minValue} olmalı.`
                  : `En fazla ${q.maxValue} olmalı.`,
          },
        };
      }
      return { value: raw, displayValue: formatNumber(raw) };
    }
  }
}

/** Reads the stored `options` JSON defensively (bad rows yield no options). */
export function parseQuestionOptions(json: unknown): CategoryQuestionOption[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((o: unknown) => {
    if (typeof o !== 'object' || o === null) return [];
    const { value, label } = o as { value?: unknown; label?: unknown };
    return typeof value === 'string' && typeof label === 'string' ? [{ value, label }] : [];
  });
}
