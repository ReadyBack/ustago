import type { NamedRef } from './address.js';
import type { CategoryRef, JobStatus, ProviderRating } from './marketplace.js';
import type { Money } from './money.js';
import type { PublicReview } from './lifecycle.js';
import type { PortfolioItem } from './provider-ops.js';

/**
 * Faz 7 customer discovery: search, provider discovery, public profile V2,
 * favorites, home, price guide and the dynamic request form
 * (docs/adr/0028, 0029).
 */

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** How a category matched the query. FUZZY = typo-tolerant ("elektirik"). */
export type SearchMatchKind = 'NAME' | 'ALIAS' | 'PREFIX' | 'FUZZY';

export interface SearchCategoryHit {
  category: CategoryRef;
  matchKind: SearchMatchKind;
  /** The name or alias that matched. */
  matchedText: string;
}

/** GET /search?q= */
export interface SearchResult {
  query: string;
  categories: SearchCategoryHit[];
  /** Filled when nothing matched: related categories to try instead. */
  suggestions: CategoryRef[];
  noResult: boolean;
}

// ---------------------------------------------------------------------------
// Provider discovery and public profile V2
// ---------------------------------------------------------------------------

export type ProviderSort =
  'RECOMMENDED' | 'NEAREST' | 'RATING' | 'COMPLETED_JOBS' | 'RESPONSE_TIME';

/** Straight-line distance between district centres, rounded ("Yaklaşık 12 km"). */
export interface ApproxDistance {
  km: number;
  /** Always true: no road-routing service is used (docs/adr/0029). */
  approximate: true;
}

/**
 * Real response data, shown only above a minimum sample: "Genellikle 12 dk
 * içinde yanıt verir". Null when there is not enough data.
 */
export interface ResponseStats {
  medianMinutes: number;
  responseRatePercent: number;
  sampleSize: number;
}

/** Provider card in search results, favorites and home sections. */
export interface ProviderCard {
  id: string;
  displayName: string;
  photoUrl: string | null;
  isVerified: boolean;
  rating: ProviderRating | null;
  completedJobCount: number;
  ustaScore: number | null;
  isNewProvider: boolean;
  categories: CategoryRef[];
  /** Approximate area label, e.g. "Seyhan, Çukurova / Adana". */
  areaLabel: string;
  distance: ApproxDistance | null;
  availableToday: boolean;
  responseStats: ResponseStats | null;
  isFavorite: boolean;
  /**
   * Approximate map position: the provider's service-centre district
   * centre, never a home address (docs/adr/0029). Null when unknown.
   */
  approxPoint: { lat: number; lng: number } | null;
}

export interface ReviewDistribution {
  /** Counts of published reviews per star, 5 → 1. */
  five: number;
  four: number;
  three: number;
  two: number;
  one: number;
}

export type ReviewSort = 'NEWEST' | 'HIGHEST' | 'LOWEST';

/** GET /providers/:id (V2). Never phone, e-mail, national id, documents, IBAN or address. */
export interface PublicProviderProfileV2 {
  id: string;
  displayName: string;
  photoUrl: string | null;
  bio: string | null;
  yearsOfExperience: number | null;
  isVerified: boolean;
  ustaScore: number | null;
  isNewProvider: boolean;
  rating: ProviderRating | null;
  reviewDistribution: ReviewDistribution;
  completedJobCount: number;
  categories: CategoryRef[];
  /** Human-readable coverage, e.g. ["Adana: Seyhan, Çukurova", "Mersin (tüm il)"]. */
  serviceAreaLabels: string[];
  distance: ApproxDistance | null;
  availability: { availableToday: boolean; onTimeOff: boolean; acceptingNewJobs: boolean };
  responseStats: ResponseStats | null;
  portfolio: PortfolioItem[];
  recentReviews: PublicReview[];
  isFavorite: boolean;
  memberSince: string;
}

// ---------------------------------------------------------------------------
// Favorites, rehire, home
// ---------------------------------------------------------------------------

export interface FavoriteProvider {
  provider: ProviderCard;
  /** False when the provider is suspended, banned or no longer listed. */
  available: boolean;
  unavailableReason: 'SUSPENDED' | 'NOT_LISTED' | null;
  createdAt: string;
}

/** GET /jobs/:id/rehire: what the "Bu ustayı tekrar çağır" wizard starts from. */
export interface RehireDraft {
  jobId: string;
  category: CategoryRef;
  provider: { id: string; displayName: string; available: boolean };
  /** The previous address if it still exists; the customer must confirm it. */
  addressId: string | null;
  /** Suggested title; the description is never copied. */
  title: string;
}

export interface HomeJobCard {
  jobId: string;
  status: JobStatus;
  category: CategoryRef;
  providerName: string;
  total: Money;
  updatedAt: string;
}

export interface HomeRequestCard {
  requestId: string;
  title: string;
  category: CategoryRef;
  status: string;
  openQuoteCount: number;
  createdAt: string;
}

export interface HomeRehireCard {
  jobId: string;
  provider: ProviderCard;
  category: CategoryRef;
  completedAt: string;
}

/** GET /me/home (customer). Sections without real data are empty, not faked. */
export interface CustomerHome {
  /** Approximate area used for "Yakınındaki ustalar" (default address district). */
  area: { province: NamedRef<number>; district: NamedRef } | null;
  launchStatus: ProvinceLaunchStatus | null;
  activeJobs: HomeJobCard[];
  requestsWithQuotes: HomeRequestCard[];
  favorites: ProviderCard[];
  rehire: HomeRehireCard[];
  recentCategories: CategoryRef[];
  /** Ranked by real request counts in the last 30 days; empty below the threshold. */
  popularCategories: CategoryRef[];
  nearbyProviders: ProviderCard[];
}

/** ACTIVE: open; WAITLIST: requests accepted while supply is built; DISABLED: closed. */
export type ProvinceLaunchStatus = 'ACTIVE' | 'WAITLIST' | 'DISABLED';

// ---------------------------------------------------------------------------
// Request form (dynamic questions) and price guide
// ---------------------------------------------------------------------------

export type CategoryQuestionType =
  'SINGLE_SELECT' | 'MULTI_SELECT' | 'BOOLEAN' | 'SHORT_TEXT' | 'NUMBER';

export interface CategoryQuestionOption {
  value: string;
  label: string;
}

export interface CategoryQuestion {
  id: string;
  key: string;
  label: string;
  helpText: string | null;
  type: CategoryQuestionType;
  options: CategoryQuestionOption[];
  required: boolean;
  minValue: number | null;
  maxValue: number | null;
  sortOrder: number;
  isActive: boolean;
}

/** Stored with the request at publication; question edits never change it. */
export interface CategoryAnswerSnapshot {
  questionId: string;
  key: string;
  label: string;
  type: CategoryQuestionType;
  /** Raw answer: string, number, boolean or string[] (MULTI_SELECT). */
  value: string | number | boolean | string[];
  /** Human-readable answer ("Evet", "Tamamen kesik"). */
  displayValue: string;
}

export type RequestPhotoPolicy = 'OPTIONAL' | 'RECOMMENDED' | 'REQUIRED';

/** GET /categories/:id/request-form */
export interface RequestForm {
  category: CategoryRef;
  photoPolicy: RequestPhotoPolicy;
  maxPhotos: number;
  maxPhotoBytes: number;
  supportsNow: boolean;
  questions: CategoryQuestion[];
}

/**
 * GET /categories/:id/price-guide. Real completed-job prices only, shown
 * above a minimum sample from several providers; otherwise
 * INSUFFICIENT_DATA ("Henüz yeterli veri yok").
 */
export type PriceGuide =
  | { status: 'INSUFFICIENT_DATA'; scope: 'PROVINCE' | 'COUNTRY'; minSample: number }
  | {
      status: 'OK';
      scope: 'PROVINCE' | 'COUNTRY';
      p25: Money;
      median: Money;
      p75: Money;
      /** Rounded down to a multiple of 10 ("10+ iş"). */
      sampleSizeFloor: number;
      periodDays: number;
    };

/** "Ne zaman?" in the request wizard. */
export type ScheduleOption = 'NOW' | 'TODAY' | 'TOMORROW' | 'DATE';

/** The provider's own arrival estimate on a quote (no routing API). */
export type QuoteEta = 'MIN_30' | 'HOUR_1' | 'HOUR_2' | 'TODAY' | 'TOMORROW' | 'CUSTOM';

/** Objective labels on the offer comparison; only when there is a unique winner. */
export type QuoteComparisonLabel = 'LOWEST_PRICE' | 'NEAREST' | 'HIGHEST_RATED';

/** Dispatch progress on the customer's request ("7 uygun ustaya gönderildi"). */
export interface DispatchSummary {
  wave: number;
  dispatchedCount: number;
  viewedCount: number;
  quoteCount: number;
  lastDispatchedAt: string | null;
  nextDispatchAt: string | null;
  /** The customer may widen the search now ("Arama alanını genişlet"). */
  canExpand: boolean;
  /** No quote after the configured wait: show the "henüz teklif gelmedi" prompt. */
  noOfferPrompt: boolean;
  /** No provider could be reached (no supply or waitlist province). */
  supply: 'OK' | 'NONE' | 'WAITLIST';
  preferredProvider: {
    id: string;
    displayName: string;
    status: 'WAITING' | 'VIEWED' | 'QUOTED' | 'UNAVAILABLE';
    only: boolean;
  } | null;
}
