import type { NamedRef } from './address.js';
import type { CategoryRef } from './marketplace.js';

/** Faz 7 admin marketplace analytics (docs/adr/0028). Real events only. */

export type MarketplaceEventName =
  | 'request_created'
  | 'request_dispatched'
  | 'provider_viewed_request'
  | 'quote_created'
  | 'quote_accepted'
  | 'job_started'
  | 'job_completed'
  | 'conversation_started'
  | 'message_sent'
  | 'provider_favorited'
  | 'provider_rehired'
  | 'search_performed'
  | 'search_no_result'
  | 'search_category_clicked'
  | 'request_no_offer'
  | 'request_search_expanded';

export interface FunnelStep {
  key: 'created' | 'dispatched' | 'viewed' | 'quoted' | 'accepted' | 'started' | 'completed';
  label: string;
  /** Distinct requests that reached this step in the period. */
  requests: number;
}

/** GET /admin/marketplace/overview?days= */
export interface MarketplaceOverview {
  periodDays: number;
  timeZone: string;
  today: { requestsCreated: number; quotes: number; jobsCompleted: number };
  /** Percentages are null when the denominator is 0. */
  quoteRatePercent: number | null;
  acceptanceRatePercent: number | null;
  completionRatePercent: number | null;
  medianFirstQuoteMinutes: number | null;
  noOfferOpenRequests: number;
  activeProviders: number;
  availableProviders: number;
  funnel: FunnelStep[];
  search: {
    searches: number;
    noResult: number;
    topNoResultQueries: { query: string; count: number }[];
  };
}

/**
 * Region row (province or district). Counts below the privacy threshold are
 * returned as null and shown as "<5".
 */
export interface RegionStats {
  province: NamedRef<number>;
  district: NamedRef | null;
  requests: number | null;
  quotes: number | null;
  completedJobs: number | null;
  activeProviders: number;
  availableProviders: number;
  /** requests / available providers; null without available providers. */
  demandPerProvider: number | null;
  /** Requests with no dispatch at all (no supply). */
  unservedRequests: number | null;
  launchStatus: 'ACTIVE' | 'WAITLIST' | 'DISABLED';
}

export interface CategoryStats {
  category: CategoryRef;
  requests: number;
  quotes: number;
  acceptanceRatePercent: number | null;
  completionRatePercent: number | null;
  /** Median agreed price (kuruş) over completed jobs; null below the sample threshold. */
  medianPriceMinor: number | null;
  activeProviders: number;
}

export interface MatchBreakdownLine {
  key: string;
  label: string;
  points: number;
}

export interface AdminDispatchRow {
  providerId: string;
  providerName: string;
  wave: number;
  algorithmVersion: string;
  matchScore: number;
  breakdown: MatchBreakdownLine[];
  distanceKm: number | null;
  isPreferred: boolean;
  notifyMode: 'PUSH' | 'IN_APP' | 'NONE';
  dispatchedAt: string;
  viewedAt: string | null;
  respondedAt: string | null;
  result: 'PENDING' | 'QUOTED' | 'CLOSED';
}

/** GET /admin/service-requests/:id/dispatch — request → dispatch → quote timeline. */
export interface AdminDispatchTimeline {
  requestId: string;
  wave: number;
  nextDispatchAt: string | null;
  rows: AdminDispatchRow[];
  events: {
    type: MarketplaceEventName;
    occurredAt: string;
    providerId: string | null;
    value: number | null;
  }[];
}

/** GET /admin/marketplace/match-preview?requestId= (debug; ranking internals). */
export interface AdminMatchPreview {
  requestId: string;
  algorithmVersion: string;
  candidates: {
    providerId: string;
    providerName: string;
    score: number;
    breakdown: MatchBreakdownLine[];
    distanceKm: number | null;
    alreadyDispatched: boolean;
  }[];
  durationMs: number;
}

export interface NoOfferRequestRow {
  id: string;
  title: string;
  category: CategoryRef;
  province: NamedRef<number>;
  district: NamedRef;
  wave: number;
  dispatchedCount: number;
  publishedAt: string | null;
  ageMinutes: number;
}
