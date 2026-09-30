import type { WeeklyHoursInterval } from '@ustago/types';
import {
  MAX_WEEKLY_INTERVALS,
  type SetWeeklyHours,
  setWeeklyHoursSchema,
  weeklyIntervalsOverlap,
} from '@ustago/validation';

import { minutesToHHMM, parseHHMM, WEEKDAYS } from './labels';

/** One editable row: times as typed ("09:00"). */
export interface IntervalDraft {
  key: string;
  weekday: number;
  start: string;
  end: string;
}

let seq = 0;
export const draftKey = () => `i${++seq}`;

export function toDrafts(hours: readonly WeeklyHoursInterval[]): IntervalDraft[] {
  return [...hours]
    .sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute)
    .map((h) => ({
      key: draftKey(),
      weekday: h.weekday,
      start: minutesToHHMM(h.startMinute),
      end: minutesToHHMM(h.endMinute),
    }));
}

const dayName = (weekday: number) => WEEKDAYS.find((d) => d.value === weekday)?.label ?? '';

/**
 * Turns the rows into the PUT body, with the same rules as
 * setWeeklyHoursSchema (valid times, start before end, no overlap on a day).
 */
export function buildWeeklyHours(
  drafts: readonly IntervalDraft[],
): { ok: true; body: SetWeeklyHours } | { ok: false; error: string } {
  if (drafts.length > MAX_WEEKLY_INTERVALS) {
    return { ok: false, error: `En fazla ${MAX_WEEKLY_INTERVALS} saat aralığı girilebilir.` };
  }
  const hours: WeeklyHoursInterval[] = [];
  for (const d of drafts) {
    const start = parseHHMM(d.start);
    const end = parseHHMM(d.end);
    if (start === null || end === null || start >= 1440) {
      return { ok: false, error: `${dayName(d.weekday)}: saatleri 09:00 biçiminde yazın.` };
    }
    if (start >= end) {
      return { ok: false, error: `${dayName(d.weekday)}: bitiş saati başlangıçtan sonra olmalı.` };
    }
    hours.push({ weekday: d.weekday, startMinute: start, endMinute: end });
  }
  if (weeklyIntervalsOverlap(hours)) {
    const sorted = [...hours].sort(
      (a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute,
    );
    const clash = sorted.find((cur, i) => {
      const prev = sorted[i - 1];
      return prev !== undefined && prev.weekday === cur.weekday && cur.startMinute < prev.endMinute;
    });
    return {
      ok: false,
      error: `${clash ? `${dayName(clash.weekday)}: ` : ''}Aynı gün için çakışan saat aralıkları var.`,
    };
  }
  const parsed = setWeeklyHoursSchema.safeParse({ hours });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Saatleri kontrol edin.' };
  }
  return { ok: true, body: parsed.data };
}
