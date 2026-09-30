import type {
  AdminServiceRequestListItem,
  ApproximateLocation,
  CategoryRef,
  JobSummary,
  Opportunity,
  ServiceAddress,
  ServiceRequest,
  ServiceRequestListItem,
  ServiceRequestPhoto,
} from '@ustago/types';

import { toMoney, toMoneyOrNull } from '../common/money.js';
import type { Prisma } from '../generated/prisma/client.js';
import { isQuoteOpen } from '../quotes/domain/quote-negotiation.js';
import { editableFields, transitionFor } from './domain/service-request-lifecycle.js';

export const categoryRefSelect = {
  id: true,
  slug: true,
  name: true,
  icon: true,
} satisfies Prisma.ServiceCategorySelect;

const locationInclude = {
  category: { select: categoryRefSelect },
  province: { select: { id: true, name: true } },
  district: { select: { id: true, name: true } },
} satisfies Prisma.ServiceRequestInclude;

const photosInclude = {
  photos: {
    orderBy: { sortOrder: 'asc' },
    select: { id: true, mimeType: true, sizeBytes: true },
  },
} satisfies Prisma.ServiceRequestInclude;

const jobSummaryInclude = {
  job: {
    select: {
      id: true,
      status: true,
      agreedPriceMinor: true,
      currency: true,
      createdAt: true,
      provider: { select: { id: true, displayName: true } },
    },
  },
} satisfies Prisma.ServiceRequestInclude;

/** The customer's own full view. */
export const customerRequestInclude = {
  ...locationInclude,
  ...photosInclude,
  ...jobSummaryInclude,
  address: {
    include: {
      province: { select: { id: true, name: true } },
      district: { select: { id: true, name: true } },
    },
  },
  quotes: { select: { status: true } },
} satisfies Prisma.ServiceRequestInclude;

export const listRequestInclude = {
  ...locationInclude,
  ...jobSummaryInclude,
  quotes: { select: { status: true } },
} satisfies Prisma.ServiceRequestInclude;

/** Deliberately without address, customer and quotes (privacy, docs/adr/0014). */
export const opportunityInclude = {
  ...locationInclude,
  ...photosInclude,
} satisfies Prisma.ServiceRequestInclude;

type CustomerRow = Prisma.ServiceRequestGetPayload<{ include: typeof customerRequestInclude }>;
type ListRow = Prisma.ServiceRequestGetPayload<{ include: typeof listRequestInclude }>;
type OpportunityRow = Prisma.ServiceRequestGetPayload<{ include: typeof opportunityInclude }>;
type LocationRow = Prisma.ServiceRequestGetPayload<{ include: typeof locationInclude }>;
type JobSummaryRow = NonNullable<Prisma.ServiceRequestGetPayload<{ include: typeof jobSummaryInclude }>['job']>;
type AddressRow = CustomerRow['address'];

export function toCategoryRef(c: CategoryRef): CategoryRef {
  return { id: c.id, slug: c.slug, name: c.name, icon: c.icon };
}

export function toLocation(r: Pick<LocationRow, 'province' | 'district'>): ApproximateLocation {
  return {
    province: { id: r.province.id, name: r.province.name },
    district: { id: r.district.id, name: r.district.name },
  };
}

/** Full address; only for the customer and, after agreement, the job's provider. */
export function toServiceAddress(a: AddressRow): ServiceAddress {
  return {
    addressId: a.id,
    label: a.label,
    province: { id: a.province.id, name: a.province.name },
    district: { id: a.district.id, name: a.district.name },
    neighborhood: a.neighborhood,
    addressLine: a.addressLine,
    buildingNo: a.buildingNo,
    apartmentNo: a.apartmentNo,
    postalCode: a.postalCode,
    instructions: a.instructions,
    latitude: a.latitude === null ? null : Number(a.latitude),
    longitude: a.longitude === null ? null : Number(a.longitude),
  };
}

export function toJobSummary(job: JobSummaryRow): JobSummary {
  return {
    id: job.id,
    status: job.status,
    agreedPrice: toMoney(job.agreedPriceMinor, job.currency),
    provider: { id: job.provider.id, displayName: job.provider.displayName },
    createdAt: job.createdAt.toISOString(),
  };
}

function toPhotos(photos: OpportunityRow['photos']): ServiceRequestPhoto[] {
  return photos.map((p) => ({ id: p.id, mimeType: p.mimeType, sizeBytes: p.sizeBytes }));
}

function quoteCounts(quotes: { status: Parameters<typeof isQuoteOpen>[0] }[]) {
  return {
    quoteCount: quotes.length,
    openQuoteCount: quotes.filter((q) => isQuoteOpen(q.status)).length,
  };
}

/**
 * The customer's view. The address may since have been soft deleted; past
 * requests keep pointing at it.
 */
export function toServiceRequest(r: CustomerRow): ServiceRequest {
  const hasQuotes = r.quotes.length > 0;
  const editable = editableFields(r.status, hasQuotes);
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    title: r.title,
    description: r.description,
    category: toCategoryRef(r.category),
    address: toServiceAddress(r.address),
    budget: toMoneyOrNull(r.budgetMinor, r.currency),
    preferredStartAt: r.preferredStartAt?.toISOString() ?? null,
    preferredEndAt: r.preferredEndAt?.toISOString() ?? null,
    publishedAt: r.publishedAt?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    cancelReason: r.cancelReason,
    photos: toPhotos(r.photos),
    ...quoteCounts(r.quotes),
    job: r.job ? toJobSummary(r.job) : null,
    actions: {
      edit: editable.length > 0,
      editCriticalFields: editable.includes('categoryId'),
      publish: r.status === 'DRAFT',
      cancel: transitionFor(r.status, 'CANCEL', r.type) !== null,
    },
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toServiceRequestListItem(r: ListRow): ServiceRequestListItem {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    title: r.title,
    category: toCategoryRef(r.category),
    location: toLocation(r),
    budget: toMoneyOrNull(r.budgetMinor, r.currency),
    ...quoteCounts(r.quotes),
    agreedPrice: r.job ? toMoney(r.job.agreedPriceMinor, r.job.currency) : null,
    jobId: r.job?.id ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/**
 * What a provider sees before any agreement. Built field by field from an
 * allow-list: no customer identity, phone or e-mail, no street, building,
 * apartment, postal code, coordinates or directions.
 */
export function toOpportunity(r: OpportunityRow, myQuoteId: string | null): Opportunity {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    title: r.title,
    description: r.description,
    category: toCategoryRef(r.category),
    location: toLocation(r),
    budget: toMoneyOrNull(r.budgetMinor, r.currency),
    preferredStartAt: r.preferredStartAt?.toISOString() ?? null,
    preferredEndAt: r.preferredEndAt?.toISOString() ?? null,
    publishedAt: r.publishedAt?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    photos: toPhotos(r.photos),
    myQuoteId,
  };
}

export const adminListInclude = {
  ...listRequestInclude,
  customer: { select: { user: { select: { id: true, firstName: true, lastName: true } } } },
} satisfies Prisma.ServiceRequestInclude;
type AdminListRow = Prisma.ServiceRequestGetPayload<{ include: typeof adminListInclude }>;

export function fullName(u: { firstName: string; lastName: string }): string {
  return `${u.firstName} ${u.lastName}`.trim();
}

export function toAdminListItem(r: AdminListRow): AdminServiceRequestListItem {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    title: r.title,
    category: toCategoryRef(r.category),
    location: toLocation(r),
    budget: toMoneyOrNull(r.budgetMinor, r.currency),
    quoteCount: r.quotes.length,
    agreedPrice: r.job ? toMoney(r.job.agreedPriceMinor, r.job.currency) : null,
    customer: { id: r.customer.user.id, name: fullName(r.customer.user) },
    createdAt: r.createdAt.toISOString(),
  };
}
