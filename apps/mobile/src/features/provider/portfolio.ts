import {
  type CreatePortfolioItem,
  createPortfolioItemSchema,
  type UpdatePortfolioItem,
  updatePortfolioItemSchema,
} from '@ustago/validation';

/** Every box must be ticked before a portfolio item is saved (no automatic face detection). */
export const PORTFOLIO_CONSENTS: readonly { key: string; label: string }[] = [
  {
    key: 'no-personal-data',
    label: 'Fotoğraflarda müşteri yüzü, adres, plaka veya kişisel bilgi yok.',
  },
  { key: 'permission', label: 'Bu fotoğrafları paylaşma iznim var.' },
  { key: 'own-work', label: 'Fotoğraflar kendi yaptığım işe ait.' },
];

export interface PortfolioDraft {
  title: string;
  description: string;
  categoryId: string | null;
  uploadIds: string[];
  consents: Record<string, boolean>;
}

export const allConsentsGiven = (consents: Record<string, boolean>) =>
  PORTFOLIO_CONSENTS.every((c) => consents[c.key] === true);

/** POST body, checked with the shared schema; consent is required. */
export function buildPortfolioItem(
  d: PortfolioDraft,
): { ok: true; body: CreatePortfolioItem } | { ok: false; error: string } {
  if (!allConsentsGiven(d.consents)) {
    return { ok: false, error: 'Kaydetmeden önce onay kutularının hepsini işaretle.' };
  }
  const parsed = createPortfolioItemSchema.safeParse({
    title: d.title,
    description: d.description.trim() ? d.description : null,
    categoryId: d.categoryId,
    uploadIds: d.uploadIds,
    consentConfirmed: true,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Bilgileri kontrol et.' };
  }
  return { ok: true, body: parsed.data };
}

export function buildPortfolioUpdate(d: {
  title: string;
  description: string;
  categoryId: string | null;
}): { ok: true; body: UpdatePortfolioItem } | { ok: false; error: string } {
  const parsed = updatePortfolioItemSchema.safeParse({
    title: d.title,
    description: d.description.trim() ? d.description : null,
    categoryId: d.categoryId,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Bilgileri kontrol et.' };
  }
  return { ok: true, body: parsed.data };
}

/** Moves one id up (-1) or down (+1); unchanged at the ends. */
export function moveId(ids: readonly string[], id: string, delta: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return [...ids];
  const next = [...ids];
  [next[i], next[j]] = [next[j] as string, next[i] as string];
  return next;
}
