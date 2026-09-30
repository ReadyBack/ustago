import { describe, expect, it } from 'vitest';

import {
  adminFeePolicySchema,
  adminProvider360Schema,
  adminVerificationCaseDetailSchema,
  categoryTreeSchema,
} from './schemas';

const ID = '0190a000-0000-7000-8000-00000000000a';
const AT = '2026-09-30T10:00:00.000Z';
const TRY = (amountMinor: number) => ({ amountMinor, currency: 'TRY' as const });

describe('Faz 6 response schemas', () => {
  it('accept a verification case as the API maps it', () => {
    const parsed = adminVerificationCaseDetailSchema.safeParse({
      providerId: ID,
      userId: ID,
      displayName: 'Usta Ali',
      contact: { firstName: 'Ali', lastName: 'Kaya', phoneMasked: '+9053*****12' },
      status: 'UNDER_REVIEW',
      providerStatus: 'PENDING_REVIEW',
      accountStatus: 'ACTIVE',
      method: 'MANUAL',
      source: 'WORKFLOW',
      submittedAt: AT,
      submissionCount: 1,
      reviewStartedAt: AT,
      reviewedBy: { id: ID, name: 'Admin' },
      decidedAt: null,
      decisionBy: null,
      decisionReasonCode: null,
      userVisibleReason: null,
      internalNote: null,
      verifiedAt: null,
      version: 3,
      categories: ['Elektrik'],
      areas: ['İstanbul / Kadıköy'],
      checklist: [{ key: 'PROFILE', label: 'Profil', done: true }],
      documents: [
        {
          id: ID,
          type: 'IDENTITY',
          status: 'PENDING',
          mimeType: 'image/png',
          sizeBytes: 1000,
          originalFileName: 'kimlik.png',
          submittedAt: AT,
          reviewedAt: null,
          rejectionReason: null,
          sha256: null,
          scanStatus: 'NOT_SCANNED',
          duplicateOfOtherProvider: false,
        },
      ],
      requiredDocumentTypes: ['IDENTITY'],
      timeline: [
        {
          id: ID,
          event: 'provider.verification.submitted',
          fromStatus: 'IN_PROGRESS',
          toStatus: 'SUBMITTED',
          actorType: 'PROVIDER',
          userVisibleReason: null,
          createdAt: AT,
          actor: null,
          reasonCode: null,
          internalNote: null,
        },
      ],
      actions: { startReview: false, approve: true, requestRevision: true, reject: true },
    });
    expect(parsed.success).toBe(true);
  });

  it('accept a provider 360 with free-form status maps', () => {
    const parsed = adminProvider360Schema.safeParse({
      providerId: ID,
      userId: ID,
      displayName: 'Usta Ali',
      applicationStatus: 'ACTIVE',
      accountStatus: 'SUSPENDED',
      verificationStatus: 'VERIFIED',
      capabilities: {
        listed: false,
        canQuote: false,
        canTakeNowJobs: false,
        canRequestPayout: false,
        showVerifiedBadge: true,
        restrictions: ['Hesap askıda'],
      },
      createdAt: AT,
      contact: { name: 'Ali Kaya', phone: null, email: null },
      suspensions: [],
      jobs: { total: 2, byStatus: { COMPLETED: 2 }, recent: [] },
      reviews: { published: 0, hidden: 0, average: null, recent: [] },
      quality: { ustaScore: null, sampleSize: 0, isNewProvider: true, computedAt: null },
      finance: {
        balances: {
          pending: TRY(0),
          held: TRY(0),
          available: TRY(1000),
          reserved: TRY(0),
          platformDebt: TRY(0),
          withdrawable: TRY(1000),
          paidOut: TRY(0),
        },
        earningsByStatus: { AVAILABLE: TRY(1000) },
        recentPayouts: [],
        destination: null,
      },
      penalties: [],
      audit: [],
    });
    expect(parsed.success).toBe(true);
  });

  it('refuse a fee policy with an unknown lifecycle', () => {
    const policy = {
      id: ID,
      code: 'standart',
      name: 'Standart',
      currency: 'TRY',
      bps: 1000,
      fixed: TRY(0),
      min: null,
      max: null,
      effectiveFrom: AT,
      lifecycle: 'ACTIVE',
      scope: 'GLOBAL',
      isDevelopment: false,
      publishedAt: AT,
      publishedBy: null,
      retiredAt: null,
      jobsUsing: 4,
      createdAt: AT,
    };
    expect(adminFeePolicySchema.safeParse(policy).success).toBe(true);
    expect(adminFeePolicySchema.safeParse({ ...policy, lifecycle: 'LIVE' }).success).toBe(false);
  });

  it('keep category children from the tree', () => {
    const category = {
      id: ID,
      parentId: null,
      slug: 'elektrik',
      name: 'Elektrik',
      description: null,
      icon: null,
      sortOrder: 1,
      isActive: true,
      supportsNow: true,
      supportsQuote: true,
    };
    const parsed = categoryTreeSchema.parse([
      { ...category, children: [{ ...category, parentId: ID, name: 'Priz' }] },
    ]);
    expect(parsed[0]?.children[0]?.name).toBe('Priz');
  });
});
