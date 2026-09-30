import { describe, expect, it } from 'vitest';

import { type EligibilityInput, ineligibilityReason, isEligible } from './eligibility.js';

const NOW = new Date('2026-09-30T10:00:00Z');

function input(overrides: {
  request?: Partial<EligibilityInput['request']>;
  category?: Partial<EligibilityInput['category']>;
  province?: Partial<EligibilityInput['province']>;
  district?: Partial<EligibilityInput['district']>;
  override?: EligibilityInput['override'];
  provider?: Partial<EligibilityInput['provider']>;
}): EligibilityInput {
  return {
    request: {
      type: 'QUOTE',
      status: 'PUBLISHED',
      expiresAt: new Date('2026-10-14T10:00:00Z'),
      categoryId: 'klima',
      districtId: 'seyhan',
      customerUserId: 'customer',
      customerActive: true,
      ...overrides.request,
    },
    category: { active: true, supportsNow: true, supportsQuote: true, ...overrides.category },
    province: { active: true, ...overrides.province },
    district: { active: true, ...overrides.district },
    override: overrides.override ?? null,
    provider: {
      userId: 'provider',
      status: 'ACTIVE',
      nowEnabled: true,
      isAvailableNow: true,
      categoryIds: ['klima'],
      districtIds: ['seyhan', 'cukurova'],
      jobRestricted: false,
      nowSuspended: false,
      ...overrides.provider,
    },
    now: NOW,
  };
}

describe('opportunity eligibility', () => {
  it('matches an ACTIVE provider serving the category and district', () => {
    expect(isEligible(input({}))).toBe(true);
    expect(isEligible(input({ request: { status: 'QUOTED' } }))).toBe(true);
  });

  it.each([
    ['inactive provider', { provider: { status: 'SUSPENDED' as const } }, 'PROVIDER_NOT_ACTIVE'],
    [
      'pending provider',
      { provider: { status: 'PENDING_REVIEW' as const } },
      'PROVIDER_NOT_ACTIVE',
    ],
    ['job restriction in force', { provider: { jobRestricted: true } }, 'PROVIDER_RESTRICTED'],
    ['wrong district', { request: { districtId: 'yuregir' } }, 'DISTRICT_NOT_SERVED'],
    ['wrong category', { request: { categoryId: 'elektrik' } }, 'CATEGORY_NOT_SERVED'],
    ['agreed request', { request: { status: 'MATCHED' as const } }, 'REQUEST_NOT_OPEN'],
    ['draft request', { request: { status: 'DRAFT' as const } }, 'REQUEST_NOT_OPEN'],
    ['expired request', { request: { expiresAt: NOW } }, 'REQUEST_EXPIRED'],
    ['own request', { request: { customerUserId: 'provider' } }, 'OWN_REQUEST'],
    ['suspended customer', { request: { customerActive: false } }, 'CUSTOMER_INACTIVE'],
    ['inactive category', { category: { active: false } }, 'CATEGORY_CLOSED'],
    [
      'category closed in province',
      { override: { isActive: false, nowEnabled: false } },
      'CATEGORY_CLOSED',
    ],
    ['inactive province', { province: { active: false } }, 'PROVINCE_CLOSED'],
  ])('excludes %s', (_label, overrides, reason) => {
    expect(ineligibilityReason(input(overrides))).toBe(reason);
  });

  describe('NOW', () => {
    const now = { request: { type: 'NOW' as const, status: 'MATCHING' as const } };

    it('matches an available NOW provider', () => {
      expect(isEligible(input(now))).toBe(true);
    });

    it('excludes a provider who is not available right now', () => {
      expect(ineligibilityReason(input({ ...now, provider: { isAvailableNow: false } }))).toBe(
        'NOW_NOT_AVAILABLE',
      );
      expect(ineligibilityReason(input({ ...now, provider: { nowEnabled: false } }))).toBe(
        'NOW_NOT_AVAILABLE',
      );
    });

    it('excludes when the category does not support NOW', () => {
      expect(ineligibilityReason(input({ ...now, category: { supportsNow: false } }))).toBe(
        'NOW_CLOSED_IN_PROVINCE',
      );
    });

    it('re-checks the province × category NOW switch even for available providers', () => {
      expect(
        ineligibilityReason(input({ ...now, override: { isActive: true, nowEnabled: false } })),
      ).toBe('NOW_CLOSED_IN_PROVINCE');
      expect(isEligible(input({ ...now, override: { isActive: true, nowEnabled: true } }))).toBe(
        true,
      );
    });

    it('a NOW switch does not affect QUOTE requests', () => {
      expect(isEligible(input({ override: { isActive: true, nowEnabled: false } }))).toBe(true);
    });
  });
});
