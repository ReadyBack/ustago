import type { JobActions, JobStep, JobTimelineEntry } from '@ustago/types';

import type { DisputeReason, JobStatus } from '../../generated/prisma/client.js';

/**
 * Job state machine (docs/adr/0015). The only place that knows which job
 * status may follow which, who may trigger it and which timestamp it
 * writes. Services call transitionFor() and then do a conditional update
 * on the source status, so two racing requests cannot both move the job.
 *
 * Faz 1 enum names are kept; the product names map as:
 *
 *   CREATED / CONFIRMED (≈ SCHEDULED)
 *     ─EN_ROUTE─▶ PROVIDER_EN_ROUTE ─ARRIVE─▶ PROVIDER_ARRIVED ─START─▶ IN_PROGRESS
 *     ─REQUEST_COMPLETION─▶ AWAITING_COMPLETION_CONFIRMATION ─COMPLETE─▶ COMPLETED
 *
 *   CANCEL:  CREATED | CONFIRMED | PROVIDER_PREPARING → CANCELLED (either party)
 *   DISPUTE: → DISPUTED (customer). Before the provider arrived only as
 *            "Usta gelmedi" (NO_SHOW); afterwards for any reason.
 *
 * A job created from a NOW request follows exactly the same machine.
 */
export type JobParty = 'CUSTOMER' | 'PROVIDER';

export type JobAction =
  | 'EN_ROUTE'
  | 'ARRIVE'
  | 'START'
  | 'REQUEST_COMPLETION'
  | 'COMPLETE'
  | 'DISPUTE'
  | 'CANCEL';

/** Write-once step timestamps on the job row. */
export type JobStamp =
  | 'enRouteAt'
  | 'arrivedAt'
  | 'startedAt'
  | 'completionRequestedAt'
  | 'completedAt'
  | 'disputedAt'
  | 'cancelledAt';

interface Rule {
  from: readonly JobStatus[];
  to: JobStatus;
  by: readonly JobParty[];
  stamp: JobStamp;
}

/** Agreed, not started: the provider has not left yet. */
export const BEFORE_DEPARTURE = ['CREATED', 'CONFIRMED', 'PROVIDER_PREPARING'] as const;
/** The provider has not reached the address yet ("Usta gelmedi" is possible). */
const BEFORE_ARRIVAL = [...BEFORE_DEPARTURE, 'PROVIDER_EN_ROUTE'] as const;
const AFTER_ARRIVAL = ['PROVIDER_ARRIVED', 'IN_PROGRESS', 'AWAITING_COMPLETION_CONFIRMATION'] as const;

const RULES: Record<JobAction, Rule> = {
  EN_ROUTE: {
    from: BEFORE_DEPARTURE,
    to: 'PROVIDER_EN_ROUTE',
    by: ['PROVIDER'],
    stamp: 'enRouteAt',
  },
  ARRIVE: { from: ['PROVIDER_EN_ROUTE'], to: 'PROVIDER_ARRIVED', by: ['PROVIDER'], stamp: 'arrivedAt' },
  START: { from: ['PROVIDER_ARRIVED'], to: 'IN_PROGRESS', by: ['PROVIDER'], stamp: 'startedAt' },
  REQUEST_COMPLETION: {
    from: ['IN_PROGRESS'],
    to: 'AWAITING_COMPLETION_CONFIRMATION',
    by: ['PROVIDER'],
    stamp: 'completionRequestedAt',
  },
  COMPLETE: {
    from: ['AWAITING_COMPLETION_CONFIRMATION'],
    to: 'COMPLETED',
    by: ['CUSTOMER'],
    stamp: 'completedAt',
  },
  DISPUTE: {
    from: [...BEFORE_ARRIVAL, ...AFTER_ARRIVAL],
    to: 'DISPUTED',
    by: ['CUSTOMER'],
    stamp: 'disputedAt',
  },
  CANCEL: {
    from: BEFORE_DEPARTURE,
    to: 'CANCELLED',
    by: ['CUSTOMER', 'PROVIDER'],
    stamp: 'cancelledAt',
  },
};

/** Statuses of a job that is agreed and not finished. */
export const ACTIVE_JOB_STATUSES = [
  'CREATED',
  'CONFIRMED',
  'PROVIDER_PREPARING',
  'PROVIDER_EN_ROUTE',
  'PROVIDER_ARRIVED',
  'IN_PROGRESS',
  'AWAITING_COMPLETION_CONFIRMATION',
] as const satisfies readonly JobStatus[];

export const FINISHED_JOB_STATUSES = [
  'COMPLETED',
  'CANCELLED',
  'DISPUTED',
] as const satisfies readonly JobStatus[];

export type TransitionResult =
  | { kind: 'MOVE'; from: JobStatus; to: JobStatus; stamp: JobStamp }
  /** Already in the target state: a retried request (double tap). */
  | { kind: 'ALREADY_DONE'; to: JobStatus }
  | { kind: 'WRONG_PARTY' }
  | { kind: 'INVALID' };

export function ruleFor(action: JobAction): Readonly<Rule> {
  return RULES[action];
}

/**
 * Decides an action. Party is checked first so the other side never learns
 * more than "not yours"; a repeat of the action that produced the current
 * status is reported as ALREADY_DONE so callers can answer it without
 * writing anything twice.
 */
export function transitionFor(
  status: JobStatus,
  action: JobAction,
  party: JobParty,
): TransitionResult {
  const rule = RULES[action];
  if (!rule.by.includes(party)) return { kind: 'WRONG_PARTY' };
  if (status === rule.to) return { kind: 'ALREADY_DONE', to: rule.to };
  if (!rule.from.includes(status)) return { kind: 'INVALID' };
  return { kind: 'MOVE', from: status, to: rule.to, stamp: rule.stamp };
}

/** Before the provider arrives, the only complaint that makes sense is "Usta gelmedi". */
export function disputeReasonAllowed(status: JobStatus, reason: DisputeReason): boolean {
  if ((BEFORE_ARRIVAL as readonly JobStatus[]).includes(status)) return reason === 'NO_SHOW';
  return (AFTER_ARRIVAL as readonly JobStatus[]).includes(status);
}

export function isActive(status: JobStatus): boolean {
  return (ACTIVE_JOB_STATUSES as readonly JobStatus[]).includes(status);
}

// ---------------------------------------------------------------------------
// What the caller may do / see
// ---------------------------------------------------------------------------

export interface JobFacts {
  status: JobStatus;
  hasPendingChangeOrder: boolean;
  hasOpenDispute: boolean;
  review: { exists: boolean; editableUntil: Date | null };
}

function can(facts: JobFacts, action: JobAction, party: JobParty): boolean {
  return transitionFor(facts.status, action, party).kind === 'MOVE';
}

/** Mirrors the server's checks so the app can show exactly one right action. */
export function availableActions(facts: JobFacts, party: JobParty, now = new Date()): JobActions {
  const provider = party === 'PROVIDER';
  const customer = party === 'CUSTOMER';
  return {
    enRoute: can(facts, 'EN_ROUTE', party),
    arrive: can(facts, 'ARRIVE', party),
    start: can(facts, 'START', party),
    addChangeOrder: provider && facts.status === 'IN_PROGRESS' && !facts.hasPendingChangeOrder,
    requestCompletion: can(facts, 'REQUEST_COMPLETION', party) && !facts.hasPendingChangeOrder,
    complete: can(facts, 'COMPLETE', party),
    dispute: can(facts, 'DISPUTE', party) && !facts.hasOpenDispute,
    cancel: can(facts, 'CANCEL', party),
    review: customer && facts.status === 'COMPLETED' && !facts.review.exists,
    editReview:
      customer &&
      facts.review.exists &&
      facts.review.editableUntil !== null &&
      facts.review.editableUntil > now,
  };
}

export interface JobTimes {
  createdAt: Date;
  enRouteAt: Date | null;
  arrivedAt: Date | null;
  startedAt: Date | null;
  completionRequestedAt: Date | null;
  completedAt: Date | null;
}

const STEPS: readonly [JobStep, keyof JobTimes][] = [
  ['AGREED', 'createdAt'],
  ['EN_ROUTE', 'enRouteAt'],
  ['ARRIVED', 'arrivedAt'],
  ['STARTED', 'startedAt'],
  ['COMPLETION_REQUESTED', 'completionRequestedAt'],
  ['COMPLETED', 'completedAt'],
];

/**
 * The timeline both parties see. Every time is the real timestamp written
 * by the state machine; a step that has not happened has `at: null`.
 */
export function buildTimeline(job: JobTimes): JobTimelineEntry[] {
  return STEPS.map(([step, field]) => ({ step, at: job[field]?.toISOString() ?? null }));
}
