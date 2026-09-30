import type {
  Job,
  JobActions,
  JobListItem,
  JobPaymentActions,
  JobPaymentSummary,
  Payment,
  Wallet,
} from '@ustago/types';

const tl = (amountMinor: number) => ({ amountMinor, currency: 'TRY' as const });

const NO_ACTIONS: JobActions = {
  enRoute: false,
  arrive: false,
  start: false,
  addChangeOrder: false,
  requestCompletion: false,
  complete: false,
  dispute: false,
  cancel: false,
  review: false,
  editReview: false,
};

const location = {
  province: { id: 1, name: 'Adana' },
  district: { id: 'd-seyhan', name: 'Seyhan' },
};

export function jobFixture(
  overrides: Partial<Omit<Job, 'actions'>> & { actions?: Partial<JobActions> } = {},
): Job {
  const { actions, ...rest } = overrides;
  return {
    id: 'job-1',
    status: 'CONFIRMED',
    agreedPrice: tl(220000),
    currentTotal: tl(220000),
    scheduledStartAt: null,
    createdAt: '2026-09-30T08:00:00.000Z',
    enRouteAt: null,
    arrivedAt: null,
    startedAt: null,
    completionRequestedAt: null,
    completedAt: null,
    disputedAt: null,
    cancelledAt: null,
    cancellationActor: null,
    cancellationReason: null,
    timeline: [],
    changeOrders: [],
    review: null,
    dispute: null,
    serviceRequest: { id: 'req-1', type: 'QUOTE', title: 'Klima gaz dolumu', description: '—' },
    category: { id: 'cat-1', slug: 'klima', name: 'Klima', icon: null },
    address: {
      ...location,
      addressId: 'addr-1',
      label: 'Ev',
      neighborhood: 'Reşatbey',
      addressLine: 'Atatürk Cd.',
      buildingNo: '12',
      apartmentNo: '4',
      postalCode: null,
      instructions: null,
      latitude: null,
      longitude: null,
    },
    provider: { id: 'prov-1', displayName: 'Demo Klima Ustası', phone: '+905000000002' },
    customer: { name: 'Zeynep D.', phone: '+905000000011' },
    acceptedRevision: null,
    viewerRole: 'CUSTOMER',
    ...rest,
    actions: { ...NO_ACTIONS, ...actions },
  };
}

export function jobListItemFixture(overrides: Partial<JobListItem> = {}): JobListItem {
  return {
    id: 'job-1',
    status: 'PROVIDER_EN_ROUTE',
    requestType: 'QUOTE',
    agreedPrice: tl(220000),
    currentTotal: tl(270000),
    title: 'Klima gaz dolumu',
    category: { id: 'cat-1', slug: 'klima', name: 'Klima', icon: null },
    location,
    counterpart: 'Demo Klima Ustası',
    scheduledStartAt: null,
    createdAt: '2026-09-30T08:00:00.000Z',
    ...overrides,
  };
}

export function paymentFixture(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'pay-1',
    jobId: 'job-1',
    method: 'IN_APP',
    status: 'PENDING',
    amount: tl(220000),
    refunded: tl(0),
    net: tl(220000),
    testMode: true,
    lastFailureCode: null,
    createdAt: '2026-09-30T10:00:00.000Z',
    succeededAt: null,
    attempts: [],
    ...overrides,
  };
}

const NO_PAYMENT_ACTIONS: JobPaymentActions = {
  canChooseMethod: false,
  canPayOnline: false,
  canConfirmCash: false,
  canDisputeCash: false,
};

export function paymentSummaryFixture(
  overrides: Partial<Omit<JobPaymentSummary, 'actions'>> & {
    actions?: Partial<JobPaymentActions>;
  } = {},
): JobPaymentSummary {
  const { actions, ...rest } = overrides;
  return {
    jobId: 'job-1',
    viewerRole: 'CUSTOMER',
    method: 'IN_APP',
    total: tl(220000),
    paid: tl(0),
    refunded: tl(0),
    netPaid: tl(0),
    outstanding: tl(220000),
    inFlight: null,
    payments: [],
    cash: null,
    testMode: true,
    onlineEnabled: true,
    cashEnabled: true,
    providerBreakdown: null,
    ...rest,
    actions: { ...NO_PAYMENT_ACTIONS, ...actions },
  };
}

export function walletFixture(overrides: Partial<Wallet> = {}): Wallet {
  return {
    balances: {
      pending: tl(187000),
      held: tl(0),
      available: tl(250000),
      reserved: tl(50000),
      platformDebt: tl(15000),
      withdrawable: tl(235000),
      paidOut: tl(100000),
    },
    statements: [
      {
        period: 'THIS_MONTH',
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-09-30T12:00:00.000Z',
        grossJobValue: tl(500000),
        platformFees: tl(75000),
        netEarnings: tl(425000),
        paidOut: tl(100000),
      },
      {
        period: 'LAST_30_DAYS',
        from: '2026-08-31T12:00:00.000Z',
        to: '2026-09-30T12:00:00.000Z',
        grossJobValue: tl(600000),
        platformFees: tl(90000),
        netEarnings: tl(510000),
        paidOut: tl(100000),
      },
    ],
    nextReleaseAt: '2026-10-02T09:00:00.000Z',
    minPayout: tl(10000),
    payoutsEnabled: true,
    testMode: true,
    destination: null,
    recent: [],
    pendingPayouts: [],
    ...overrides,
  };
}
