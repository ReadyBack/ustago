import type { NamedRef } from './address.js';
import type {
  ChangeOrder,
  JobActions,
  JobActor,
  JobDispute,
  JobTimelineEntry,
  Review,
} from './lifecycle.js';
import type { Money } from './money.js';

/** NOW = UstaGO NOW / Acil Usta; QUOTE = Teklif Al (docs/adr/0014). */
export type ServiceRequestType = 'NOW' | 'QUOTE';

/**
 * PUBLISHED = open for quotes ("Açık"), MATCHING = NOW request looking for
 * an available provider, QUOTED = at least one open quote ("Teklif Geldi"),
 * MATCHED = a quote was accepted and a job exists ("Anlaşıldı").
 */
export type ServiceRequestStatus =
  'DRAFT' | 'PUBLISHED' | 'MATCHING' | 'QUOTED' | 'MATCHED' | 'CANCELLED' | 'EXPIRED' | 'COMPLETED';

export type QuoteStatus =
  'PENDING_CUSTOMER' | 'PENDING_PROVIDER' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN' | 'EXPIRED';

export type QuoteRevisionKind = 'OFFER' | 'CUSTOMER_COUNTER' | 'PROVIDER_COUNTER';

export type JobStatus =
  | 'CREATED'
  | 'CONFIRMED'
  | 'PROVIDER_PREPARING'
  | 'PROVIDER_EN_ROUTE'
  | 'PROVIDER_ARRIVED'
  | 'IN_PROGRESS'
  | 'AWAITING_COMPLETION_CONFIRMATION'
  | 'COMPLETED'
  | 'DISPUTED'
  | 'CANCELLED';

export interface CategoryRef {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
}

/** Province and district only: what anyone but the customer may see. */
export interface ApproximateLocation {
  province: NamedRef<number>;
  district: NamedRef;
}

/** Full address, shown to the customer and, once a job exists, to its provider. */
export interface ServiceAddress extends ApproximateLocation {
  addressId: string;
  label: string | null;
  neighborhood: string | null;
  addressLine: string;
  buildingNo: string | null;
  apartmentNo: string | null;
  postalCode: string | null;
  instructions: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface ServiceRequestPhoto {
  id: string;
  mimeType: string;
  sizeBytes: number;
}

/** A job as seen from its service request. */
export interface JobSummary {
  id: string;
  status: JobStatus;
  /** AGREED_PRICE: locked when the job was created. */
  agreedPrice: Money;
  provider: { id: string; displayName: string };
  createdAt: string;
}

/** What the caller may do right now; the server enforces the same rules. */
export interface ServiceRequestActions {
  edit: boolean;
  /** Category, address and type: only before any quote arrived. */
  editCriticalFields: boolean;
  publish: boolean;
  cancel: boolean;
}

/** The customer's own view (GET /service-requests/:id). */
export interface ServiceRequest {
  id: string;
  type: ServiceRequestType;
  status: ServiceRequestStatus;
  title: string;
  description: string;
  category: CategoryRef;
  address: ServiceAddress;
  /** Customer's estimate only; never a ceiling for quotes. Null = "bilmiyorum". */
  budget: Money | null;
  preferredStartAt: string | null;
  preferredEndAt: string | null;
  publishedAt: string | null;
  expiresAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  photos: ServiceRequestPhoto[];
  /** Quotes still under negotiation. */
  openQuoteCount: number;
  quoteCount: number;
  job: JobSummary | null;
  actions: ServiceRequestActions;
  createdAt: string;
  updatedAt: string;
}

/** Row of GET /me/service-requests ("Taleplerim"). */
export interface ServiceRequestListItem {
  id: string;
  type: ServiceRequestType;
  status: ServiceRequestStatus;
  title: string;
  category: CategoryRef;
  location: ApproximateLocation;
  budget: Money | null;
  quoteCount: number;
  openQuoteCount: number;
  /** Set once agreed. */
  agreedPrice: Money | null;
  jobId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A provider's view of an open request before any agreement
 * (docs/adr/0014 privacy): no customer identity, no street, building,
 * apartment or directions.
 */
export interface Opportunity {
  id: string;
  type: ServiceRequestType;
  status: ServiceRequestStatus;
  title: string;
  description: string;
  category: CategoryRef;
  location: ApproximateLocation;
  budget: Money | null;
  preferredStartAt: string | null;
  preferredEndAt: string | null;
  publishedAt: string | null;
  expiresAt: string | null;
  photos: ServiceRequestPhoto[];
  /** The caller's own quote on this request, if any. */
  myQuoteId: string | null;
}

/** One immutable step of a negotiation. */
export interface QuoteRevision {
  id: string;
  revisionNo: number;
  kind: QuoteRevisionKind;
  /** Who made this move. */
  by: 'PROVIDER' | 'CUSTOMER';
  total: Money;
  labor: Money | null;
  material: Money | null;
  materialsIncluded: boolean | null;
  note: string | null;
  estimatedDurationMinutes: number | null;
  availableFrom: string | null;
  validUntil: string | null;
  createdAt: string;
}

/** Real rating from published reviews; null until the first one ("Yeni Usta"). */
export interface ProviderRating {
  average: number;
  count: number;
}

/** Provider as shown on a quote card. No phone or e-mail before agreement. */
export interface QuoteProviderCard {
  id: string;
  displayName: string;
  yearsOfExperience: number | null;
  /**
   * The provider's account verification is VERIFIED and the account is not
   * suspended (Faz 6, docs/adr/0023). Never derived from demo data alone.
   */
  identityVerified: boolean;
  rating: ProviderRating | null;
  completedJobCount: number;
}

export interface QuoteActions {
  counter: boolean;
  accept: boolean;
  reject: boolean;
  withdraw: boolean;
}

/** A negotiation thread between one provider and one request. */
export interface Quote {
  id: string;
  serviceRequestId: string;
  requestType: ServiceRequestType;
  status: QuoteStatus;
  /** Whose move it is; null once the negotiation is over. */
  turn: 'CUSTOMER' | 'PROVIDER' | null;
  provider: QuoteProviderCard;
  latest: QuoteRevision;
  /** Oldest first. */
  revisions: QuoteRevision[];
  acceptedRevisionId: string | null;
  acceptedAt: string | null;
  jobId: string | null;
  /** Relative to the caller. */
  actions: QuoteActions;
  createdAt: string;
  updatedAt: string;
}

/** Row of GET /providers/me/quotes ("Tekliflerim"). */
export interface ProviderQuoteListItem {
  id: string;
  status: QuoteStatus;
  turn: 'CUSTOMER' | 'PROVIDER' | null;
  latest: QuoteRevision;
  revisionCount: number;
  request: {
    id: string;
    type: ServiceRequestType;
    status: ServiceRequestStatus;
    title: string;
    category: CategoryRef;
    location: ApproximateLocation;
    budget: Money | null;
  };
  jobId: string | null;
  updatedAt: string;
}

/** Contact details shared between the two parties of a job. */
export interface JobParty {
  name: string;
  phone: string | null;
}

/** GET /jobs/:id: visible to its customer and its provider. */
export interface Job {
  id: string;
  status: JobStatus;
  /** AGREED_PRICE: locked when the job was created, never changes. */
  agreedPrice: Money;
  /** Agreed price plus accepted change orders. */
  currentTotal: Money;
  scheduledStartAt: string | null;
  createdAt: string;
  enRouteAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  completionRequestedAt: string | null;
  completedAt: string | null;
  disputedAt: string | null;
  cancelledAt: string | null;
  cancellationActor: JobActor | null;
  cancellationReason: string | null;
  timeline: JobTimelineEntry[];
  /** Oldest first. */
  changeOrders: ChangeOrder[];
  /** The customer's review, once written (both sides see it). */
  review: Review | null;
  /** The latest dispute, if any. */
  dispute: JobDispute | null;
  actions: JobActions;
  serviceRequest: { id: string; type: ServiceRequestType; title: string; description: string };
  category: CategoryRef;
  /** Revealed to both parties once they agreed. */
  address: ServiceAddress;
  provider: { id: string; displayName: string; phone: string | null };
  customer: JobParty;
  acceptedRevision: QuoteRevision | null;
  /** The caller's side of the job. */
  viewerRole: 'CUSTOMER' | 'PROVIDER';
}

export interface JobListItem {
  id: string;
  status: JobStatus;
  requestType: ServiceRequestType;
  agreedPrice: Money;
  currentTotal: Money;
  title: string;
  category: CategoryRef;
  location: ApproximateLocation;
  counterpart: string;
  scheduledStartAt: string | null;
  createdAt: string;
}

/** In-app notification: the source of truth; push is a best-effort copy. */
export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, string> | null;
  /** The record the notification is about, e.g. PAYMENT / payment id. */
  entityType: string | null;
  entityId: string | null;
  /**
   * In-app route to open, e.g. "/payments/<id>". The target endpoint still
   * checks ownership, so a deep link never grants access (Faz 6).
   */
  deepLink: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface AdminDashboardStats {
  totalUsers: number;
  activeProviders: number;
  pendingProviders: number;
  openServiceRequests: number;
  openNowRequests: number;
  newServiceRequestsToday: number;
  jobsCreated: number;
  /** IANA time zone "today" was computed in. */
  timeZone: string;
  generatedAt: string;
}

export interface AdminServiceRequestListItem {
  id: string;
  type: ServiceRequestType;
  status: ServiceRequestStatus;
  title: string;
  category: CategoryRef;
  location: ApproximateLocation;
  budget: Money | null;
  quoteCount: number;
  agreedPrice: Money | null;
  customer: { id: string; name: string };
  createdAt: string;
}

export interface AdminQuote {
  id: string;
  status: QuoteStatus;
  provider: { id: string; displayName: string };
  revisions: QuoteRevision[];
  acceptedRevisionId: string | null;
  createdAt: string;
}

/**
 * Admin detail. Customer contact is masked and the address is shown down to
 * the neighbourhood; street, building and door numbers are not needed to
 * moderate a request.
 */
export interface AdminServiceRequestDetail {
  id: string;
  type: ServiceRequestType;
  status: ServiceRequestStatus;
  title: string;
  description: string;
  category: CategoryRef;
  location: ApproximateLocation & { neighborhood: string | null };
  budget: Money | null;
  preferredStartAt: string | null;
  preferredEndAt: string | null;
  publishedAt: string | null;
  expiresAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  photoCount: number;
  customer: { id: string; name: string; maskedPhone: string | null };
  quotes: AdminQuote[];
  job: (JobSummary & { currentTotal: Money }) | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSystemStatus {
  environment: 'development' | 'test' | 'staging' | 'production';
  version: string;
  database: 'up' | 'down';
  redis: 'up' | 'down';
  storageDriver: string;
  smsProvider: string;
  swaggerEnabled: boolean;
  corsOrigins: string[];
  checkedAt: string;
}
