import type { NamedRef } from './address.js';
import type { CategoryRef } from './marketplace.js';

/**
 * Faz 7 provider operations: service regions, availability and time off
 * (docs/adr/0028, 0031), portfolio and the provider home screen.
 */

/** PROVINCE: the whole province. RADIUS: within `radiusKm` of a centre district. */
export type ProviderRegionKind = 'PROVINCE' | 'RADIUS';

export interface ProviderServiceRegion {
  id: string;
  kind: ProviderRegionKind;
  province: NamedRef<number>;
  /** RADIUS only. A district centre, never the provider's home. */
  centerDistrict: NamedRef | null;
  radiusKm: number | null;
  active: boolean;
}

/** GET /providers/me/coverage: every way the provider covers requests. */
export interface ProviderCoverage {
  /** Single districts (the Faz 2 service areas), grouped by province. */
  districts: { province: NamedRef<number>; districts: NamedRef[] }[];
  regions: ProviderServiceRegion[];
  /** Km from the service centre; null = only the areas above limit it. */
  maxTravelKm: number | null;
  /** "Hizmet merkezi" district used for approximate distances. */
  serviceCenter: { province: NamedRef<number>; district: NamedRef } | null;
}

/** Local working interval, minutes from midnight (Europe/Istanbul). */
export interface WeeklyHoursInterval {
  /** ISO weekday, 1 = Pazartesi ... 7 = Pazar. */
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface ProviderTimeOff {
  id: string;
  startsAt: string;
  endsAt: string;
  note: string | null;
  /** True while now is inside the interval. */
  current: boolean;
}

/**
 * Why a provider does (not) get new work right now. PAUSED = "Yeni iş
 * alma" off; UNAVAILABLE_TODAY = "Bugün müsait değilim"; TIME_OFF = izin;
 * OUTSIDE_HOURS = outside the weekly hours (quote requests still arrive,
 * but ranking prefers providers working now). Account suspension is a
 * separate axis (docs/adr/0023) and is not reported here.
 */
export type AvailabilityState =
  'AVAILABLE' | 'OUTSIDE_HOURS' | 'UNAVAILABLE_TODAY' | 'TIME_OFF' | 'PAUSED';

export interface ProviderAvailability {
  state: AvailabilityState;
  /** True when new requests may be dispatched to the provider now. */
  receivesNewJobs: boolean;
  acceptingNewJobs: boolean;
  /** Set while "Bugün müsait değilim" is on. */
  unavailableUntil: string | null;
  /** NOW (Acil Usta) opt-in and "müsaitim" toggle (Faz 3). */
  nowEnabled: boolean;
  isAvailableNow: boolean;
  /** Empty = hours not set: treated as flexible. */
  weeklyHours: WeeklyHoursInterval[];
  /** Current and upcoming time off, soonest first. */
  timeOff: ProviderTimeOff[];
  timeZone: string;
}

export interface PortfolioMediaItem {
  id: string;
  kind: 'IMAGE';
  mimeType: string;
  /** Short-lived signed URL (private storage, docs/adr/0011). */
  url: string;
}

export interface PortfolioItem {
  id: string;
  title: string;
  description: string | null;
  category: CategoryRef | null;
  sortOrder: number;
  media: PortfolioMediaItem[];
  createdAt: string;
}

/** Deterministic profile checklist; it says nothing about ranking position. */
export interface ProfileCompleteness {
  percent: number;
  items: { key: ProfileCompletenessKey; done: boolean; label: string }[];
}
export type ProfileCompletenessKey =
  'photo' | 'bio' | 'services' | 'areas' | 'portfolio' | 'availability' | 'verification';

/** GET /providers/me/home. Every number is a live count, never an estimate. */
export interface ProviderHome {
  availability: ProviderAvailability;
  /** Open requests dispatched to the provider that they have not opened yet. */
  newMatchingJobs: number;
  /** All open requests the provider may quote on. */
  openOpportunities: number;
  activeJobs: number;
  /** Quotes waiting for the customer or for the provider. */
  pendingQuotes: number;
  unreadMessages: number;
  /** Earnings recorded today (Europe/Istanbul), TEST money in development. */
  todayEarningsMinor: number;
  /** Payout-eligible balance from the ledger. */
  availableBalanceMinor: number;
  verificationStatus: string;
  profileCompleteness: ProfileCompleteness;
}
