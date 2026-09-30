import type { CategoryQuestion, RequestPhotoPolicy, ScheduleOption } from '@ustago/types';
import { MIN_PRICE_MINOR, parseTryInput } from '@ustago/validation';

/** Pure rules for the request wizard V2, kept apart from the screen so they are testable. */

export type AnswerValue = string | number | boolean | string[];
export type Answers = Record<string, AnswerValue | undefined>;

function isEmpty(v: AnswerValue | undefined): boolean {
  if (v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** Errors keyed by question key; empty when the step may continue. */
export function validateAnswers(
  questions: CategoryQuestion[],
  answers: Answers,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const q of questions) {
    if (!q.isActive) continue;
    const v = answers[q.key];
    if (isEmpty(v)) {
      if (q.required) errors[q.key] = 'Bu soru zorunlu.';
      continue;
    }
    if (q.type === 'NUMBER') {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        errors[q.key] = 'Lütfen bir sayı girin.';
      } else if (q.minValue !== null && v < q.minValue) {
        errors[q.key] = `En az ${q.minValue} olmalı.`;
      } else if (q.maxValue !== null && v > q.maxValue) {
        errors[q.key] = `En fazla ${q.maxValue} olabilir.`;
      }
    }
    if (q.type === 'SHORT_TEXT' && typeof v === 'string' && v.trim().length > 200) {
      errors[q.key] = 'En fazla 200 karakter.';
    }
  }
  return errors;
}

/** Only answered, active questions go to the server (answers are keyed by question key). */
export function answersPayload(
  questions: CategoryQuestion[],
  answers: Answers,
): Record<string, AnswerValue> {
  const out: Record<string, AnswerValue> = {};
  for (const q of questions) {
    const v = answers[q.key];
    if (!q.isActive || v === undefined || isEmpty(v)) continue;
    out[q.key] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

/** Display text of an answer for the summary step. */
export function answerLabel(q: CategoryQuestion, v: AnswerValue | undefined): string {
  if (v === undefined || isEmpty(v)) return 'Cevaplanmadı';
  if (typeof v === 'boolean') return v ? 'Evet' : 'Hayır';
  const label = (value: string) => q.options.find((o) => o.value === value)?.label ?? value;
  if (Array.isArray(v)) return v.map(label).join(', ');
  if (q.type === 'SINGLE_SELECT' && typeof v === 'string') return label(v);
  return String(v);
}

export interface BudgetResult {
  error: string | null;
  minMinor: number | null;
  maxMinor: number | null;
}

/**
 * Budget is optional. A single amount, or a range "min – max" with
 * min ≤ max (the server needs the lower bound whenever there is an upper one).
 */
export function validateBudget(minText: string, maxText: string): BudgetResult {
  const minRaw = minText.trim();
  const maxRaw = maxText.trim();
  if (minRaw === '' && maxRaw === '') return { error: null, minMinor: null, maxMinor: null };
  const min = minRaw === '' ? null : parseTryInput(minRaw);
  const max = maxRaw === '' ? null : parseTryInput(maxRaw);
  const bad = (v: number | null, raw: string) => raw !== '' && v === null;
  if (bad(min, minRaw) || bad(max, maxRaw)) {
    return { error: 'Tutarı 1.500 veya 1500,50 biçiminde yazın.', minMinor: null, maxMinor: null };
  }
  if (min === null) {
    return { error: 'Aralık için en az tutarı da girin.', minMinor: null, maxMinor: null };
  }
  if (min < MIN_PRICE_MINOR || (max !== null && max < MIN_PRICE_MINOR)) {
    return { error: 'Bütçe en az ₺1 olmalı.', minMinor: null, maxMinor: null };
  }
  if (max !== null && max < min) {
    return {
      error: 'Bütçe aralığının üst sınırı alt sınırdan küçük olamaz.',
      minMinor: null,
      maxMinor: null,
    };
  }
  return { error: null, minMinor: min, maxMinor: max !== null && max !== min ? max : null };
}

export function photoPolicyError(policy: RequestPhotoPolicy, count: number): string | null {
  return policy === 'REQUIRED' && count === 0
    ? 'Bu hizmet için en az bir fotoğraf eklemelisin.'
    : null;
}

export type TimeWindow = 'MORNING' | 'NOON' | 'AFTERNOON' | 'EVENING' | 'ANY';

export const TIME_WINDOWS: { value: TimeWindow; label: string; from: number; to: number }[] = [
  { value: 'ANY', label: 'Gün içinde (09–19)', from: 9, to: 19 },
  { value: 'MORNING', label: 'Sabah (09–12)', from: 9, to: 12 },
  { value: 'NOON', label: 'Öğle (12–15)', from: 12, to: 15 },
  { value: 'AFTERNOON', label: 'Öğleden sonra (15–19)', from: 15, to: 19 },
  { value: 'EVENING', label: 'Akşam (19–22)', from: 19, to: 22 },
];

/** A window is still possible today while its end is ahead. */
export function windowAvailable(
  option: ScheduleOption,
  window: TimeWindow,
  now = new Date(),
): boolean {
  if (option !== 'TODAY') return true;
  const w = TIME_WINDOWS.find((t) => t.value === window);
  return w ? now.getHours() < w.to : false;
}

/**
 * Preferred start/end for the chosen schedule. NOW has no window (the
 * earliest available provider); DATE uses `dayOffset` days from today.
 */
export function scheduleWindow(
  option: ScheduleOption,
  window: TimeWindow,
  dayOffset: number,
  now = new Date(),
): { start: string | null; end: string | null } {
  if (option === 'NOW') return { start: null, end: null };
  const days = option === 'TODAY' ? 0 : option === 'TOMORROW' ? 1 : Math.max(0, dayOffset);
  const w = TIME_WINDOWS.find((t) => t.value === window) ?? TIME_WINDOWS[0];
  if (!w) return { start: null, end: null };
  const at = (hour: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  let start = at(w.from);
  const end = at(w.to);
  if (start < now) start = new Date(now);
  if (end <= start) return { start: start.toISOString(), end: null };
  return { start: start.toISOString(), end: end.toISOString() };
}
