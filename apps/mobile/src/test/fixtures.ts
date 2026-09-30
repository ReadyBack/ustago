import type { Job, JobActions, JobListItem } from '@ustago/types';

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
