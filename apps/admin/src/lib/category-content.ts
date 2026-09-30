import type { CategoryQuestion } from '@ustago/types';
import {
  createCategoryAliasSchema,
  createCategoryQuestionSchema,
  type CreateCategoryQuestion,
  MAX_QUESTION_OPTIONS,
  updateCategoryQuestionSchema,
  type UpdateCategoryQuestion,
} from '@ustago/validation';

/**
 * Category question form: the same checks run in the browser (before
 * submit) and in the Server Action, both through the shared Zod schemas.
 */

export type QuestionType = CategoryQuestion['type'];

export interface QuestionDraft {
  key: string;
  type: QuestionType;
  label: string;
  helpText: string;
  required: boolean;
  /** Raw input text; empty = no limit. */
  minValue: string;
  maxValue: string;
  sortOrder: string;
  isActive: boolean;
  options: { value: string; label: string }[];
}

export type PayloadResult<T> = { ok: true; body: T } | { ok: false; error: string };

export function isSelectType(type: string): boolean {
  return type === 'SINGLE_SELECT' || type === 'MULTI_SELECT';
}

export function draftFromQuestion(q: CategoryQuestion): QuestionDraft {
  return {
    key: q.key,
    type: q.type,
    label: q.label,
    helpText: q.helpText ?? '',
    required: q.required,
    minValue: q.minValue === null ? '' : String(q.minValue),
    maxValue: q.maxValue === null ? '' : String(q.maxValue),
    sortOrder: String(q.sortOrder),
    isActive: q.isActive,
    options: q.options.map((o) => ({ ...o })),
  };
}

export function emptyDraft(sortOrder = 0): QuestionDraft {
  return {
    key: '',
    type: 'SINGLE_SELECT',
    label: '',
    helpText: '',
    required: false,
    minValue: '',
    maxValue: '',
    sortOrder: String(sortOrder),
    isActive: true,
    options: [
      { value: '', label: '' },
      { value: '', label: '' },
    ],
  };
}

const INTEGER = /^-?\d{1,9}$/;

/** Empty → null; an integer → number; anything else → NaN (rejected below). */
function optionalInt(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  return INTEGER.test(t) ? Number(t) : NaN;
}

const FIELD_MESSAGES: Record<string, string> = {
  label: 'Soru metni 3–200 karakter olmalı.',
  helpText: 'Yardım metni en fazla 300 karakter olabilir.',
  sortOrder: 'Sıra 0–10000 arasında bir tam sayı olmalı.',
  minValue: 'En küçük değer bir tam sayı olmalı.',
  type: 'Bir soru türü seçin.',
};

function messageFor(error: {
  issues: readonly { message: string; path: readonly PropertyKey[]; code?: string }[];
}): string {
  const issue = error.issues[0];
  if (!issue) return 'Geçersiz istek.';
  const [field, index, sub] = issue.path;
  if (field === 'options') {
    if (typeof index === 'number' && sub === 'label') {
      return `${index + 1}. seçeneğin etiketi 1–80 karakter olmalı.`;
    }
    if (typeof index === 'number' && sub === 'value') {
      return `${index + 1}. seçenek: değer küçük harf, rakam ve _ olmalı (en fazla 40).`;
    }
    if (issue.code === 'too_big') return `En fazla ${MAX_QUESTION_OPTIONS} seçenek eklenebilir.`;
    return issue.message;
  }
  if (field === 'maxValue') {
    return issue.code === 'custom' ? issue.message : 'En büyük değer bir tam sayı olmalı.';
  }
  if (field === 'key') return issue.message;
  if (typeof field === 'string' && Object.hasOwn(FIELD_MESSAGES, field)) {
    return FIELD_MESSAGES[field] as string;
  }
  return issue.message;
}

function commonChecks(d: QuestionDraft): string | null {
  const sortOrder = d.sortOrder.trim();
  if (!/^\d{1,5}$/.test(sortOrder)) return FIELD_MESSAGES.sortOrder as string;
  if (d.type === 'NUMBER') {
    const min = optionalInt(d.minValue);
    const max = optionalInt(d.maxValue);
    if (Number.isNaN(min)) return 'En küçük değer bir tam sayı olmalı.';
    if (Number.isNaN(max)) return 'En büyük değer bir tam sayı olmalı.';
    if (min !== null && max !== null && min > max) {
      return 'En büyük değer en küçükten küçük olamaz.';
    }
  }
  if (isSelectType(d.type)) {
    const values = d.options.map((o) => o.value.trim());
    if (values.length < 2 || new Set(values).size !== values.length) {
      return 'Seçmeli sorular en az iki farklı seçenek ister.';
    }
  }
  return null;
}

function trimmedOptions(d: QuestionDraft) {
  return d.options.map((o) => ({ value: o.value.trim(), label: o.label.trim() }));
}

/** POST /admin/categories/:id/questions body, or the first Turkish error. */
export function buildCreateQuestionPayload(
  d: QuestionDraft,
): PayloadResult<CreateCategoryQuestion> {
  const early = commonChecks(d);
  if (early) return { ok: false, error: early };
  const helpText = d.helpText.trim();
  const parsed = createCategoryQuestionSchema.safeParse({
    key: d.key,
    label: d.label,
    helpText: helpText === '' ? null : helpText,
    type: d.type,
    ...(isSelectType(d.type) ? { options: trimmedOptions(d) } : {}),
    required: d.required,
    ...(d.type === 'NUMBER'
      ? { minValue: optionalInt(d.minValue), maxValue: optionalInt(d.maxValue) }
      : {}),
    sortOrder: Number(d.sortOrder.trim()),
  });
  return parsed.success
    ? { ok: true, body: parsed.data }
    : { ok: false, error: messageFor(parsed.error) };
}

/**
 * PATCH /admin/category-questions/:id body. Key and type never change
 * (published answers keep their meaning); there is no delete, only
 * `isActive: false`.
 */
export function buildUpdateQuestionPayload(
  d: QuestionDraft,
): PayloadResult<UpdateCategoryQuestion> {
  const early = commonChecks(d);
  if (early) return { ok: false, error: early };
  const helpText = d.helpText.trim();
  const parsed = updateCategoryQuestionSchema.safeParse({
    label: d.label,
    helpText: helpText === '' ? null : helpText,
    ...(isSelectType(d.type) ? { options: trimmedOptions(d) } : {}),
    required: d.required,
    ...(d.type === 'NUMBER'
      ? { minValue: optionalInt(d.minValue), maxValue: optionalInt(d.maxValue) }
      : {}),
    sortOrder: Number(d.sortOrder.trim()),
    isActive: d.isActive,
  });
  return parsed.success
    ? { ok: true, body: parsed.data }
    : { ok: false, error: messageFor(parsed.error) };
}

/** Parses the JSON draft a question form posts; null when it is not a draft. */
export function parseDraft(json: string): QuestionDraft | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : '');
  const options = Array.isArray(r.options)
    ? r.options
        .filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null)
        .map((o) => ({
          value: typeof o.value === 'string' ? o.value : '',
          label: typeof o.label === 'string' ? o.label : '',
        }))
    : [];
  return {
    key: str('key'),
    type: str('type') as QuestionType,
    label: str('label'),
    helpText: str('helpText'),
    required: r.required === true,
    minValue: str('minValue'),
    maxValue: str('maxValue'),
    sortOrder: str('sortOrder'),
    isActive: r.isActive !== false,
    options,
  };
}

/** Alias check mirroring `createCategoryAliasSchema`; null when fine. */
export function aliasError(alias: string): string | null {
  return createCategoryAliasSchema.safeParse({ alias }).success
    ? null
    : 'Eş anlamlı ifade 2–80 karakter olmalı.';
}
