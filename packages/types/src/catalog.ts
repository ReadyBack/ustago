export interface ServiceCategory {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  supportsNow: boolean;
  supportsQuote: boolean;
  /** Faz 7: how the request wizard treats photos (admin setting). */
  requestPhotoPolicy?: 'OPTIONAL' | 'RECOMMENDED' | 'REQUIRED';
}

export interface ServiceCategoryNode extends ServiceCategory {
  children: ServiceCategory[];
}

export interface Province {
  /** Official plate code, 1-81. */
  id: number;
  name: string;
  slug: string;
  isActive: boolean;
  /**
   * Faz 7 (docs/adr/0029): ACTIVE = open; WAITLIST = closed, but customers
   * may post requests that wait for supply; DISABLED = closed.
   */
  launchStatus: 'ACTIVE' | 'WAITLIST' | 'DISABLED';
  countryCode: string;
}

export interface District {
  id: string;
  provinceId: number;
  name: string;
  slug: string;
  isActive: boolean;
}

/**
 * Effective setting of a category in a province. A province without its own
 * row follows the category defaults (`source: 'DEFAULT'`).
 */
export interface ProvinceCategorySetting {
  provinceId: number;
  category: { id: string; slug: string; name: string; supportsNow: boolean };
  isActive: boolean;
  nowEnabled: boolean;
  source: 'DEFAULT' | 'OVERRIDE';
}
