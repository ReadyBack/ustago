import type {
  ProviderAccountStatus,
  ProviderStatus,
  ServiceRequestStatus,
  ServiceRequestType,
} from '../../generated/prisma/client.js';
import { type GeoPoint, HaversineDistanceCalculator } from '../../geo/distance.js';
import { isNowOpen } from '../../providers/domain/now-availability.js';
import { isOpen } from '../../service-requests/domain/service-request-lifecycle.js';

/**
 * Who may see (and quote on) a service request (docs/adr/0014). The
 * opportunity SQL in MatchingRepository applies exactly these rules in the
 * database; this pure version documents them and is unit-tested rule by
 * rule. The province × category switch is read on every call, never cached
 * on the provider: an admin turning NOW off in a province takes effect
 * immediately even though providers' `isAvailableNow` flags stay as they
 * were (docs/adr/0010).
 */
export interface EligibilityInput {
  request: {
    type: ServiceRequestType;
    status: ServiceRequestStatus;
    expiresAt: Date | null;
    categoryId: string;
    districtId: string;
    customerUserId: string;
    customerActive: boolean;
    /** Faz 7: province (for PROVINCE regions) and approximate point (district centre or coarse address). */
    provinceId?: number;
    point?: GeoPoint | null;
    /** "Sadece bu ustaya gönder" (docs/adr/0028). */
    preferredProviderId?: string | null;
    preferredOnly?: boolean;
  };
  category: { active: boolean; supportsNow: boolean; supportsQuote: boolean };
  province: { active: boolean };
  district: { active: boolean };
  /** province_categories row for the request's province and category. */
  override: { isActive: boolean; nowEnabled: boolean } | null;
  provider: {
    id?: string;
    userId: string;
    status: ProviderStatus;
    nowEnabled: boolean;
    isAvailableNow: boolean;
    categoryIds: readonly string[];
    districtIds: readonly string[];
    /** Admin sanctions in force (docs/adr/0016). */
    jobRestricted: boolean;
    nowSuspended: boolean;
    /** Faz 6 account status and verification (providers/domain/provider-policy.ts). */
    accountStatus: ProviderAccountStatus;
    verified: boolean;
    /** Documents this category requires that the provider has not had approved. */
    missingRequiredDocuments: number;
    /** Faz 7 coverage (docs/adr/0029). Omitted = districts only (Faz 2 behaviour). */
    provinceIds?: readonly number[];
    radiusRegions?: readonly { center: GeoPoint; radiusKm: number }[];
    serviceCenter?: GeoPoint | null;
    maxTravelKm?: number | null;
    /** Faz 7 availability (docs/adr/0031); omitted = available. */
    availability?: { receivesNewJobs: boolean; workingNow: boolean };
    /** Either side blocked the other (chat block, docs/adr/0030). */
    blockedWithCustomer?: boolean;
  };
  now: Date;
}

export type IneligibilityReason =
  | 'PROVIDER_NOT_ACTIVE'
  | 'PROVIDER_SUSPENDED'
  | 'PROVIDER_RESTRICTED'
  | 'CATEGORY_REQUIREMENTS_MISSING'
  | 'NOW_REQUIRES_VERIFICATION'
  | 'REQUEST_NOT_OPEN'
  | 'REQUEST_EXPIRED'
  | 'CUSTOMER_INACTIVE'
  | 'OWN_REQUEST'
  | 'CATEGORY_NOT_SERVED'
  | 'DISTRICT_NOT_SERVED'
  | 'CATEGORY_CLOSED'
  | 'PROVINCE_CLOSED'
  | 'NOW_NOT_AVAILABLE'
  | 'NOW_SUSPENDED'
  | 'NOW_CLOSED_IN_PROVINCE'
  | 'TOO_FAR'
  | 'PROVIDER_UNAVAILABLE'
  | 'PREFERRED_ONLY'
  | 'BLOCKED';

/** Straight-line distance used by the SQL too (docs/adr/0029). */
const haversine = new HaversineDistanceCalculator();

/** Does the provider's coverage include the request's location? */
export function coversRequest(
  provider: EligibilityInput['provider'],
  request: EligibilityInput['request'],
): boolean {
  if (provider.districtIds.includes(request.districtId)) return true;
  if (request.provinceId !== undefined && provider.provinceIds?.includes(request.provinceId)) {
    return true;
  }
  const point = request.point;
  if (!point) return false;
  return (provider.radiusRegions ?? []).some(
    (r) => haversine.distanceKm(r.center, point) <= r.radiusKm,
  );
}

/** Within the provider's maximum travel distance (only when a service centre is set). */
export function withinTravelLimit(
  provider: EligibilityInput['provider'],
  request: EligibilityInput['request'],
): boolean {
  if (!provider.maxTravelKm || !provider.serviceCenter || !request.point) return true;
  return haversine.distanceKm(provider.serviceCenter, request.point) <= provider.maxTravelKm;
}

/** First failing rule, or null when the provider may see the request. */
export function ineligibilityReason(input: EligibilityInput): IneligibilityReason | null {
  const { request, category, province, district, override, provider } = input;
  if (provider.status !== 'ACTIVE') return 'PROVIDER_NOT_ACTIVE';
  if (provider.accountStatus !== 'ACTIVE' && provider.accountStatus !== 'LIMITED') {
    return 'PROVIDER_SUSPENDED';
  }
  if (provider.jobRestricted) return 'PROVIDER_RESTRICTED';
  if (!isOpen(request.status)) return 'REQUEST_NOT_OPEN';
  if (request.expiresAt && request.expiresAt <= input.now) return 'REQUEST_EXPIRED';
  if (!request.customerActive) return 'CUSTOMER_INACTIVE';
  if (request.customerUserId === provider.userId) return 'OWN_REQUEST';
  if (!provider.categoryIds.includes(request.categoryId)) return 'CATEGORY_NOT_SERVED';
  if (!coversRequest(provider, request)) return 'DISTRICT_NOT_SERVED';
  if (!withinTravelLimit(provider, request)) return 'TOO_FAR';
  if (
    request.preferredOnly &&
    request.preferredProviderId &&
    request.preferredProviderId !== provider.id
  ) {
    return 'PREFERRED_ONLY';
  }
  if (provider.blockedWithCustomer) return 'BLOCKED';
  if (provider.availability && !provider.availability.receivesNewJobs)
    return 'PROVIDER_UNAVAILABLE';
  if (!category.active || (override !== null && !override.isActive)) return 'CATEGORY_CLOSED';
  if (!province.active || !district.active) return 'PROVINCE_CLOSED';
  if (provider.missingRequiredDocuments > 0) return 'CATEGORY_REQUIREMENTS_MISSING';

  if (request.type === 'QUOTE') {
    return category.supportsQuote ? null : 'CATEGORY_CLOSED';
  }
  if (!provider.nowEnabled || !provider.isAvailableNow) return 'NOW_NOT_AVAILABLE';
  if (provider.availability && !provider.availability.workingNow) return 'NOW_NOT_AVAILABLE';
  if (provider.nowSuspended) return 'NOW_SUSPENDED';
  if (!provider.verified || provider.accountStatus !== 'ACTIVE') {
    return 'NOW_REQUIRES_VERIFICATION';
  }
  const nowOpen = isNowOpen({
    provinceActive: province.active,
    categoryActive: category.active,
    categorySupportsNow: category.supportsNow,
    override,
  });
  return nowOpen ? null : 'NOW_CLOSED_IN_PROVINCE';
}

export function isEligible(input: EligibilityInput): boolean {
  return ineligibilityReason(input) === null;
}
