/**
 * Is UstaGO NOW open for a category in a province? (docs/adr/0010)
 *
 * The province must be open, the category active and NOW-capable. A
 * ProvinceCategory row, when present, overrides the category defaults for
 * that province (admin: "Adana → Klima aktif, NOW aktif"); a missing row
 * means "follow the category".
 */
export interface NowOpenInput {
  provinceActive: boolean;
  categoryActive: boolean;
  categorySupportsNow: boolean;
  override: { isActive: boolean; nowEnabled: boolean } | null;
}

export function isNowOpen(input: NowOpenInput): boolean {
  if (!input.provinceActive || !input.categoryActive || !input.categorySupportsNow) return false;
  if (!input.override) return true;
  return input.override.isActive && input.override.nowEnabled;
}

/** Effective category settings for a province, as shown to admins. */
export function effectiveProvinceCategory(
  category: { isActive: boolean; supportsNow: boolean },
  override: { isActive: boolean; nowEnabled: boolean } | null,
): { isActive: boolean; nowEnabled: boolean; source: 'DEFAULT' | 'OVERRIDE' } {
  if (override) {
    return {
      isActive: category.isActive && override.isActive,
      nowEnabled:
        category.isActive && category.supportsNow && override.isActive && override.nowEnabled,
      source: 'OVERRIDE',
    };
  }
  return {
    isActive: category.isActive,
    nowEnabled: category.isActive && category.supportsNow,
    source: 'DEFAULT',
  };
}
