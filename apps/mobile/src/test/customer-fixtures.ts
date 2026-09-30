import type {
  AppNotification,
  CategoryQuestion,
  DispatchSummary,
  ProviderCard,
  Quote,
  QuoteRevision,
} from '@ustago/types';

const tl = (amountMinor: number) => ({ amountMinor, currency: 'TRY' as const });

export function providerCardFixture(overrides: Partial<ProviderCard> = {}): ProviderCard {
  return {
    id: 'p-1',
    displayName: 'Ahmet Usta',
    photoUrl: null,
    isVerified: true,
    rating: { average: 4.7, count: 23 },
    completedJobCount: 41,
    ustaScore: 82,
    isNewProvider: false,
    categories: [{ id: 'cat-1', slug: 'elektrik', name: 'Elektrik', icon: null }],
    areaLabel: 'Seyhan, Çukurova / Adana',
    distance: { km: 12.4, approximate: true },
    availableToday: true,
    responseStats: { medianMinutes: 12, responseRatePercent: 90, sampleSize: 30 },
    isFavorite: false,
    approxPoint: { lat: 36.99, lng: 35.32 },
    ...overrides,
  };
}

function revision(overrides: Partial<QuoteRevision> = {}): QuoteRevision {
  return {
    id: 'rev-1',
    revisionNo: 1,
    kind: 'OFFER',
    by: 'PROVIDER',
    total: tl(150000),
    labor: tl(100000),
    material: tl(50000),
    materialsIncluded: true,
    service: null,
    other: null,
    arrivalEta: 'HOUR_1',
    note: null,
    estimatedDurationMinutes: 60,
    availableFrom: null,
    validUntil: null,
    createdAt: '2026-09-30T10:00:00.000Z',
    ...overrides,
  };
}

export function quoteFixture(
  overrides: Partial<Omit<Quote, 'latest'>> & { latest?: Partial<QuoteRevision> } = {},
): Quote {
  const { latest, ...rest } = overrides;
  const rev = revision(latest);
  return {
    id: 'q-1',
    serviceRequestId: 'r-1',
    requestType: 'QUOTE',
    status: 'PENDING_CUSTOMER',
    turn: 'CUSTOMER',
    provider: {
      id: 'p-1',
      displayName: 'Ahmet Usta',
      yearsOfExperience: 8,
      identityVerified: true,
      rating: { average: 4.7, count: 23 },
      completedJobCount: 41,
    },
    latest: rev,
    revisions: [rev],
    acceptedRevisionId: null,
    acceptedAt: null,
    jobId: null,
    actions: { counter: true, accept: true, reject: true, withdraw: false },
    createdAt: '2026-09-30T10:00:00.000Z',
    updatedAt: '2026-09-30T10:00:00.000Z',
    comparisonLabels: [],
    distance: { km: 7, approximate: true },
    conversationId: null,
    ...rest,
  };
}

export function dispatchFixture(overrides: Partial<DispatchSummary> = {}): DispatchSummary {
  return {
    wave: 1,
    dispatchedCount: 7,
    viewedCount: 3,
    quoteCount: 1,
    lastDispatchedAt: '2026-09-30T10:00:00.000Z',
    nextDispatchAt: null,
    canExpand: false,
    noOfferPrompt: false,
    supply: 'OK',
    preferredProvider: null,
    ...overrides,
  };
}

export function questionFixture(overrides: Partial<CategoryQuestion> = {}): CategoryQuestion {
  return {
    id: 'qq-1',
    key: 'power_state',
    label: 'Elektrik tamamen kesik mi?',
    helpText: null,
    type: 'SINGLE_SELECT',
    options: [
      { value: 'all', label: 'Tamamen kesik' },
      { value: 'partial', label: 'Bazı prizler' },
    ],
    required: true,
    minValue: null,
    maxValue: null,
    sortOrder: 0,
    isActive: true,
    ...overrides,
  };
}

export function notificationFixture(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'n-1',
    type: 'job.en_route',
    title: 'Ustanız yola çıktı',
    body: 'Ahmet Usta yola çıktı.',
    data: null,
    entityType: 'JOB',
    entityId: 'job-1',
    deepLink: '/jobs/job-1',
    category: 'JOBS',
    readAt: null,
    createdAt: '2026-09-30T10:00:00.000Z',
    ...overrides,
  };
}
