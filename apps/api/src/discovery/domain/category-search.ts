import type { SearchMatchKind } from '@ustago/types';
import { editDistance, normalizeSearchText, typoBudget } from '@ustago/validation';

/**
 * Category search (docs/adr/0028): Turkish normalisation, admin-managed
 * aliases ("sigorta attı" → Elektrik), prefix matches and a bounded typo
 * tolerance ("elektirik"). Pure and deterministic; no AI, no guessing
 * beyond the edit budget.
 */
export interface SearchableCategory {
  id: string;
  name: string;
  sortOrder: number;
  aliases: readonly string[];
}

export interface CategoryHit {
  categoryId: string;
  matchKind: SearchMatchKind;
  matchedText: string;
  /** Lower is better. */
  rank: number;
}

const KIND_RANK: Record<SearchMatchKind, number> = { NAME: 0, ALIAS: 1, PREFIX: 2, FUZZY: 3 };

function words(text: string): string[] {
  return text.split(' ').filter((w) => w.length > 0);
}

/** Best way `query` (normalised) matches `text`, or null. */
function matchText(
  query: string,
  text: string,
  exactKind: 'NAME' | 'ALIAS',
): { kind: SearchMatchKind; distance: number } | null {
  const t = normalizeSearchText(text);
  if (t.length === 0) return null;
  if (t === query) return { kind: exactKind, distance: 0 };
  // "elektrikci" for "Elektrikçi", "su kacagi var" contains "su kacagi".
  if (exactKind === 'ALIAS' && (query.includes(t) || (query.length >= 4 && t.includes(query)))) {
    return { kind: 'ALIAS', distance: Math.abs(t.length - query.length) };
  }
  const qWords = words(query);
  const tWords = words(t);
  if (query.length >= 2 && (t.startsWith(query) || tWords.some((w) => w.startsWith(query)))) {
    return { kind: exactKind === 'NAME' ? 'PREFIX' : 'ALIAS', distance: t.length - query.length };
  }
  // Every query word must be close to some word of the text.
  let total = 0;
  for (const qw of qWords) {
    const budget = typoBudget(qw.length);
    let best = budget + 1;
    for (const tw of tWords) {
      const cand = tw.startsWith(qw) && qw.length >= 4 ? 0 : editDistance(qw, tw, budget);
      if (cand < best) best = cand;
    }
    if (best > budget) return null;
    total += best;
  }
  return {
    kind: total === 0 ? (exactKind === 'NAME' ? 'PREFIX' : 'ALIAS') : 'FUZZY',
    distance: total,
  };
}

export function searchCategories(
  rawQuery: string,
  categories: readonly SearchableCategory[],
  limit: number,
): CategoryHit[] {
  const query = normalizeSearchText(rawQuery);
  if (query.length === 0) return [];
  const hits: (CategoryHit & { distance: number; sortOrder: number })[] = [];
  for (const c of categories) {
    let best: { kind: SearchMatchKind; distance: number; text: string } | null = null;
    const consider = (text: string, kind: 'NAME' | 'ALIAS') => {
      const m = matchText(query, text, kind);
      if (!m) return;
      if (
        !best ||
        KIND_RANK[m.kind] < KIND_RANK[best.kind] ||
        (KIND_RANK[m.kind] === KIND_RANK[best.kind] && m.distance < best.distance)
      ) {
        best = { ...m, text };
      }
    };
    consider(c.name, 'NAME');
    for (const a of c.aliases) consider(a, 'ALIAS');
    const found = best as { kind: SearchMatchKind; distance: number; text: string } | null;
    if (found) {
      hits.push({
        categoryId: c.id,
        matchKind: found.kind,
        matchedText: found.text,
        rank: KIND_RANK[found.kind],
        distance: found.distance,
        sortOrder: c.sortOrder,
      });
    }
  }
  hits.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.distance - b.distance ||
      a.sortOrder - b.sortOrder ||
      (a.categoryId < b.categoryId ? -1 : 1),
  );
  return hits
    .slice(0, limit)
    .map(({ categoryId, matchKind, matchedText, rank }) => ({
      categoryId,
      matchKind,
      matchedText,
      rank,
    }));
}
