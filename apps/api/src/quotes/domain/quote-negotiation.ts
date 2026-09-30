import type {
  QuoteRevisionKind,
  QuoteStatus,
  ServiceRequestType,
} from '../../generated/prisma/client.js';

/**
 * Negotiation rules for one quote thread (docs/adr/0014).
 *
 * Strict turn-taking: whoever did NOT make the latest move is the only one
 * who may answer it (counter, accept). This keeps the history honest: a
 * side cannot post three prices in a row or quietly lower its own offer
 * after the other side accepted it. Each move is a new immutable
 * QuoteRevision; nothing is edited or deleted.
 *
 *   OFFER (provider) ──▶ PENDING_CUSTOMER ──CUSTOMER_COUNTER──▶ PENDING_PROVIDER
 *          ▲                    │                                   │
 *          └──PROVIDER_COUNTER──┼───────────────────────────────────┘
 *                               ├─CUSTOMER_ACCEPT──▶ ACCEPTED (latest provider price)
 *   PENDING_PROVIDER ──PROVIDER_ACCEPT──▶ ACCEPTED (latest customer price)
 *   any open ──CUSTOMER_REJECT──▶ REJECTED     any open ──PROVIDER_WITHDRAW──▶ WITHDRAWN
 *
 * NOW requests are about speed: the provider sends one price and the
 * customer accepts or rejects it; counter offers are not part of NOW.
 */
export type Party = 'CUSTOMER' | 'PROVIDER';

export type QuoteAction =
  | 'CUSTOMER_COUNTER'
  | 'PROVIDER_COUNTER'
  | 'CUSTOMER_ACCEPT'
  | 'PROVIDER_ACCEPT'
  | 'CUSTOMER_REJECT'
  | 'PROVIDER_WITHDRAW';

export const OPEN_QUOTE_STATUSES = [
  'PENDING_CUSTOMER',
  'PENDING_PROVIDER',
] as const satisfies readonly QuoteStatus[];

const TRANSITIONS: Record<QuoteAction, { from: readonly QuoteStatus[]; to: QuoteStatus }> = {
  CUSTOMER_COUNTER: { from: ['PENDING_CUSTOMER'], to: 'PENDING_PROVIDER' },
  PROVIDER_COUNTER: { from: ['PENDING_PROVIDER'], to: 'PENDING_CUSTOMER' },
  CUSTOMER_ACCEPT: { from: ['PENDING_CUSTOMER'], to: 'ACCEPTED' },
  PROVIDER_ACCEPT: { from: ['PENDING_PROVIDER'], to: 'ACCEPTED' },
  CUSTOMER_REJECT: { from: OPEN_QUOTE_STATUSES, to: 'REJECTED' },
  PROVIDER_WITHDRAW: { from: OPEN_QUOTE_STATUSES, to: 'WITHDRAWN' },
};

export const ACTION_PARTY: Record<QuoteAction, Party> = {
  CUSTOMER_COUNTER: 'CUSTOMER',
  PROVIDER_COUNTER: 'PROVIDER',
  CUSTOMER_ACCEPT: 'CUSTOMER',
  PROVIDER_ACCEPT: 'PROVIDER',
  CUSTOMER_REJECT: 'CUSTOMER',
  PROVIDER_WITHDRAW: 'PROVIDER',
};

export function quoteTransition(from: QuoteStatus, action: QuoteAction): QuoteStatus | null {
  const rule = TRANSITIONS[action];
  return rule.from.includes(from) ? rule.to : null;
}

export function quoteSourceStatuses(action: QuoteAction): readonly QuoteStatus[] {
  return TRANSITIONS[action].from;
}

export function isQuoteOpen(status: QuoteStatus): boolean {
  return (OPEN_QUOTE_STATUSES as readonly QuoteStatus[]).includes(status);
}

/** Whose move it is, or null when the thread is closed. */
export function turnOf(status: QuoteStatus): Party | null {
  if (status === 'PENDING_CUSTOMER') return 'CUSTOMER';
  if (status === 'PENDING_PROVIDER') return 'PROVIDER';
  return null;
}

export function counterAction(party: Party): QuoteAction {
  return party === 'CUSTOMER' ? 'CUSTOMER_COUNTER' : 'PROVIDER_COUNTER';
}

export function acceptAction(party: Party): QuoteAction {
  return party === 'CUSTOMER' ? 'CUSTOMER_ACCEPT' : 'PROVIDER_ACCEPT';
}

export function revisionKindFor(action: QuoteAction): QuoteRevisionKind {
  if (action === 'CUSTOMER_COUNTER') return 'CUSTOMER_COUNTER';
  if (action === 'PROVIDER_COUNTER') return 'PROVIDER_COUNTER';
  throw new Error(`${action} does not create a revision`);
}

/** Who made a revision. Revision 1 is always the provider's OFFER. */
export function authorOf(kind: QuoteRevisionKind): Party {
  return kind === 'CUSTOMER_COUNTER' ? 'CUSTOMER' : 'PROVIDER';
}

export function canCounter(requestType: ServiceRequestType): boolean {
  return requestType === 'QUOTE';
}

export interface QuoteActionFlags {
  counter: boolean;
  accept: boolean;
  reject: boolean;
  withdraw: boolean;
}

/** What `party` may do now; mirrors the checks in QuotesService. */
export function allowedActions(
  status: QuoteStatus,
  party: Party,
  requestType: ServiceRequestType,
  requestOpen: boolean,
  revisionCount: number,
  maxRevisions: number,
): QuoteActionFlags {
  if (!requestOpen || !isQuoteOpen(status)) {
    return { counter: false, accept: false, reject: false, withdraw: false };
  }
  const myTurn = turnOf(status) === party;
  return {
    counter: myTurn && canCounter(requestType) && revisionCount < maxRevisions,
    accept: myTurn,
    reject: party === 'CUSTOMER',
    withdraw: party === 'PROVIDER',
  };
}
