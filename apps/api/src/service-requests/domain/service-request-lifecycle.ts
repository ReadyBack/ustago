import type { ServiceRequestStatus, ServiceRequestType } from '../../generated/prisma/client.js';

/**
 * Service request lifecycle (docs/adr/0014). Every status change goes
 * through transitionFor(); services never write `status` from a request
 * body, and every write is a conditional update on `sourceStatuses()` so
 * two racing actions cannot both succeed.
 *
 *   DRAFT ─PUBLISH─▶ PUBLISHED (QUOTE) / MATCHING (NOW)
 *                        │ QUOTE_RECEIVED            ▲ LAST_QUOTE_CLOSED
 *                        ▼                           │
 *                      QUOTED ───────────────────────┘
 *                        │ QUOTE_ACCEPTED
 *                        ▼
 *                      MATCHED ─JOB_COMPLETED─▶ COMPLETED
 *
 *   CANCEL: DRAFT | PUBLISHED | MATCHING | QUOTED → CANCELLED
 *   EXPIRE: PUBLISHED | MATCHING | QUOTED → EXPIRED
 */
export type ServiceRequestEvent =
  | 'PUBLISH'
  | 'QUOTE_RECEIVED'
  | 'LAST_QUOTE_CLOSED'
  | 'QUOTE_ACCEPTED'
  | 'CANCEL'
  | 'EXPIRE'
  | 'JOB_COMPLETED';

/** Statuses in which providers can still quote and customers can accept. */
export const OPEN_STATUSES = [
  'PUBLISHED',
  'MATCHING',
  'QUOTED',
] as const satisfies readonly ServiceRequestStatus[];

type Rule = {
  from: readonly ServiceRequestStatus[];
  to: (type: ServiceRequestType, from: ServiceRequestStatus) => ServiceRequestStatus;
};

/** Status a request waits in before any quote arrived. */
export const waitingStatus = (type: ServiceRequestType): ServiceRequestStatus =>
  type === 'NOW' ? 'MATCHING' : 'PUBLISHED';

const TRANSITIONS: Record<ServiceRequestEvent, Rule> = {
  PUBLISH: { from: ['DRAFT'], to: waitingStatus },
  // A second, third... quote leaves the request QUOTED.
  QUOTE_RECEIVED: { from: OPEN_STATUSES, to: () => 'QUOTED' },
  LAST_QUOTE_CLOSED: { from: ['QUOTED'], to: waitingStatus },
  QUOTE_ACCEPTED: { from: OPEN_STATUSES, to: () => 'MATCHED' },
  CANCEL: { from: ['DRAFT', ...OPEN_STATUSES], to: () => 'CANCELLED' },
  EXPIRE: { from: OPEN_STATUSES, to: () => 'EXPIRED' },
  JOB_COMPLETED: { from: ['MATCHED'], to: () => 'COMPLETED' },
};

/** Target status, or null when the event is not allowed from `from`. */
export function transitionFor(
  from: ServiceRequestStatus,
  event: ServiceRequestEvent,
  type: ServiceRequestType,
): ServiceRequestStatus | null {
  const rule = TRANSITIONS[event];
  return rule.from.includes(from) ? rule.to(type, from) : null;
}

/** Statuses an event may start from; used in conditional (race-safe) updates. */
export function sourceStatuses(event: ServiceRequestEvent): readonly ServiceRequestStatus[] {
  return TRANSITIONS[event].from;
}

export function isOpen(status: ServiceRequestStatus): boolean {
  return (OPEN_STATUSES as readonly ServiceRequestStatus[]).includes(status);
}

export type EditableField =
  | 'title'
  | 'description'
  | 'budgetMinor'
  | 'preferredStartAt'
  | 'preferredEndAt'
  | 'categoryId'
  | 'addressId';

const TEXT_FIELDS: readonly EditableField[] = [
  'title',
  'description',
  'budgetMinor',
  'preferredStartAt',
  'preferredEndAt',
];
const CRITICAL_FIELDS: readonly EditableField[] = ['categoryId', 'addressId'];

/**
 * What the customer may change. Category and address decide who sees the
 * request and what a price means, so they are frozen once any provider has
 * quoted (a quote for "klima montajı in Seyhan" must not silently become a
 * quote for something else). Nothing changes after agreement.
 */
export function editableFields(
  status: ServiceRequestStatus,
  hasQuotes: boolean,
): readonly EditableField[] {
  if (status === 'DRAFT') return [...TEXT_FIELDS, ...CRITICAL_FIELDS];
  if (!isOpen(status)) return [];
  return hasQuotes ? TEXT_FIELDS : [...TEXT_FIELDS, ...CRITICAL_FIELDS];
}

/** Fields in `changes` that may not be edited now (empty = allowed). */
export function forbiddenEdits(
  status: ServiceRequestStatus,
  hasQuotes: boolean,
  changes: readonly EditableField[],
): EditableField[] {
  const allowed = editableFields(status, hasQuotes);
  return changes.filter((field) => !allowed.includes(field));
}
