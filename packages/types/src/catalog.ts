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
}

export interface District {
  id: string;
  provinceId: number;
  name: string;
  slug: string;
  isActive: boolean;
}
