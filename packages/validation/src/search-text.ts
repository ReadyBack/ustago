/**
 * Turkish search normalisation (Faz 7, docs/adr/0028). Shared by the API
 * (matching category names and aliases) and the apps.
 *
 * - Turkish-aware lower-casing ("İ" → "i", "I" → "ı"), then folding of the
 *   Turkish letters to ASCII ("ş" → "s", "ı" → "i", "ğ" → "g", ...), so
 *   "ELEKTRİKÇİ", "elektrikci" and "Elektrikçi" are the same key.
 * - Punctuation becomes a space, whitespace is collapsed.
 */
export function normalizeSearchText(input: string): string {
  return input
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Damerau-Levenshtein (optimal string alignment) distance, capped at `max + 1`. */
export function editDistance(a: string, b: string, max = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const cols = b.length + 1;
  // Flat (a.length + 1) x (b.length + 1) matrix.
  const d = new Int32Array((a.length + 1) * cols);
  const at = (i: number, j: number) => d[i * cols + j] ?? 0;
  for (let j = 0; j < cols; j++) d[j] = j;
  for (let i = 1; i <= a.length; i++) {
    d[i * cols] = i;
    let rowMin = i;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, at(i - 2, j - 2) + 1);
      }
      d[i * cols + j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
  }
  return at(a.length, b.length);
}

/**
 * Typo budget for a word of this length: short words must match exactly
 * (otherwise "boya" would match "baya"), longer words tolerate one or two
 * edits ("elektirik" → "elektrik").
 */
export function typoBudget(length: number): number {
  if (length <= 3) return 0;
  if (length <= 6) return 1;
  return 2;
}

/**
 * Removes things that look like personal data before a query is stored for
 * analytics: digit runs (phone numbers, ids) and anything with "@". Returns
 * null when nothing useful is left.
 */
export function sanitizeQueryForAnalytics(input: string): string | null {
  if (input.includes('@')) return null;
  const cleaned = normalizeSearchText(input)
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return cleaned.length >= 2 ? cleaned : null;
}
