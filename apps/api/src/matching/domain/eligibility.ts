import type {
  ProviderStatus,
  ServiceRequestStatus,
  ServiceRequestType,
} from '../../generated/prisma/client.js';
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
  };
  category: { active: boolean; supportsNow: boolean; supportsQuote: boolean };
  province: { active: boolean };
  district: { active: boolean };
  /** province_categories row for the request's province and category. */
  override: { isActive: boolean; nowEnabled: boolean } | null;
  provider: {
    userId: string;
    status: ProviderStatus;
    nowEnabled: boolean;
    isAvailableNow: boolean;
    categoryIds: readonly string[];
    districtIds: readonly string[];
    /** Admin sanctions in force (docs/adr/0016). */
    jobRestricted: boolean;
    nowSuspended: boolean;
  };
  now: Date;
}

export type IneligibilityReason =
  | 'PROVIDER_NOT_ACTIVE'
  | 'PROVIDER_RESTRICTED'
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
  | 'NOW_CLOSED_IN_PROVINCE';

/** First failing rule, or null when the provider may see the request. */
export function ineligibilityReason(input: EligibilityInput): IneligibilityReason | null {
  const { request, category, province, district, override, provider } = input;
  if (provider.status !== 'ACTIVE') return 'PROVIDER_NOT_ACTIVE';
  if (provider.jobRestricted) return 'PROVIDER_RESTRICTED';
  if (!isOpen(request.status)) return 'REQUEST_NOT_OPEN';
  if (request.expiresAt && request.expiresAt <= input.now) return 'REQUEST_EXPIRED';
  if (!request.customerActive) return 'CUSTOMER_INACTIVE';
  if (request.customerUserId === provider.userId) return 'OWN_REQUEST';
  if (!provider.categoryIds.includes(request.categoryId)) return 'CATEGORY_NOT_SERVED';
  if (!provider.districtIds.includes(request.districtId)) return 'DISTRICT_NOT_SERVED';
  if (!category.active || (override !== null && !override.isActive)) return 'CATEGORY_CLOSED';
  if (!province.active || !district.active) return 'PROVINCE_CLOSED';

  if (request.type === 'QUOTE') {
    return category.supportsQuote ? null : 'CATEGORY_CLOSED';
  }
  if (!provider.nowEnabled || !provider.isAvailableNow) return 'NOW_NOT_AVAILABLE';
  if (provider.nowSuspended) return 'NOW_SUSPENDED';
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
