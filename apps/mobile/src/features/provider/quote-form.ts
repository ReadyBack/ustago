import type { QuoteEta } from '@ustago/types';
import {
  type CreateQuote,
  createQuoteSchema,
  MIN_PRICE_MINOR,
  parseTryInput,
} from '@ustago/validation';

import { parseTrDate } from './labels';

export type QuoteLineKey = 'labor' | 'material' | 'service' | 'other';

export const QUOTE_LINES: readonly { key: QuoteLineKey; label: string; placeholder: string }[] = [
  { key: 'labor', label: 'İşçilik', placeholder: '1.500' },
  { key: 'material', label: 'Malzeme', placeholder: '0' },
  { key: 'service', label: 'Servis / ulaşım', placeholder: '0' },
  { key: 'other', label: 'Diğer', placeholder: '0' },
];

export interface QuoteFormValues {
  lines: Record<QuoteLineKey, string>;
  note: string;
  eta: QuoteEta | null;
  customDate: string;
  customTime: string;
  durationText: string;
}

export const EMPTY_QUOTE_FORM: QuoteFormValues = {
  lines: { labor: '', material: '', service: '', other: '' },
  note: '',
  eta: null,
  customDate: '',
  customTime: '',
  durationText: '',
};

export interface Breakdown {
  /** Kuruş per line; null = left empty. */
  parts: Record<QuoteLineKey, number | null>;
  /** Sum of the filled lines; null when nothing valid was typed. */
  total: number | null;
  /** The first line that is not a clear amount. */
  invalidLine: QuoteLineKey | null;
}

/** The total is always the sum of the lines: it is computed, never typed. */
export function computeBreakdown(lines: Record<QuoteLineKey, string>): Breakdown {
  const parts = { labor: null, material: null, service: null, other: null } as Record<
    QuoteLineKey,
    number | null
  >;
  let invalidLine: QuoteLineKey | null = null;
  let total = 0;
  let any = false;
  for (const { key } of QUOTE_LINES) {
    const text = lines[key].trim();
    if (!text) continue;
    const minor = parseTryInput(text);
    if (minor === null) {
      invalidLine ??= key;
      continue;
    }
    parts[key] = minor;
    total += minor;
    any = true;
  }
  return { parts, total: any ? total : null, invalidLine };
}

const LINE_LABEL: Record<QuoteLineKey, string> = Object.fromEntries(
  QUOTE_LINES.map((l) => [l.key, l.label]),
) as Record<QuoteLineKey, string>;

/**
 * Builds the POST body and checks it with the shared createQuoteSchema, so
 * the app refuses exactly what the API would refuse.
 */
export function buildQuotePayload(
  v: QuoteFormValues,
): { ok: true; body: CreateQuote } | { ok: false; error: string } {
  const b = computeBreakdown(v.lines);
  if (b.invalidLine) {
    return {
      ok: false,
      error: `${LINE_LABEL[b.invalidLine]} tutarını 1.500 veya 1500,50 biçiminde yazın.`,
    };
  }
  if (b.total === null || b.total < MIN_PRICE_MINOR) {
    return { ok: false, error: 'Toplam en az 1 TL olmalı. İşçilik veya diğer kalemleri yazın.' };
  }
  if (!v.eta) return { ok: false, error: 'Ne zaman gelebileceğini seç.' };

  let availableFrom: string | null = null;
  if (v.eta === 'CUSTOM') {
    availableFrom = parseTrDate(v.customDate, v.customTime || '09:00');
    if (!availableFrom) {
      return { ok: false, error: 'Özel tarihi GG.AA.YYYY ve saati SS:DD biçiminde yazın.' };
    }
    if (new Date(availableFrom).getTime() < Date.now()) {
      return { ok: false, error: 'Özel tarih geçmişte olamaz.' };
    }
  }

  const minutes = v.durationText.trim() ? Number.parseInt(v.durationText, 10) : null;
  if (minutes !== null && (!Number.isFinite(minutes) || minutes < 5)) {
    return { ok: false, error: 'Süreyi dakika olarak yazın (en az 5).' };
  }

  const body: CreateQuote = {
    totalMinor: b.total,
    ...(b.parts.labor !== null ? { laborMinor: b.parts.labor } : {}),
    ...(b.parts.material !== null ? { materialMinor: b.parts.material } : {}),
    ...(b.parts.service !== null ? { serviceMinor: b.parts.service } : {}),
    ...(b.parts.other !== null ? { otherMinor: b.parts.other } : {}),
    ...(b.parts.material !== null ? { materialsIncluded: b.parts.material > 0 } : {}),
    arrivalEta: v.eta,
    ...(availableFrom ? { availableFrom } : {}),
    ...(minutes !== null ? { estimatedDurationMinutes: minutes } : {}),
    ...(v.note.trim() ? { note: v.note.trim() } : {}),
  };
  const parsed = createQuoteSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Teklif bilgilerini kontrol et.',
    };
  }
  return { ok: true, body: parsed.data };
}
