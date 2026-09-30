import type { JobStatus } from '../../generated/prisma/client.js';
import {
  ACTIVE_JOB_STATUSES,
  availableActions,
  buildTimeline,
  disputeReasonAllowed,
  FINISHED_JOB_STATUSES,
  type JobFacts,
  transitionFor,
} from './job-state-machine.js';

const facts = (status: JobStatus, over: Partial<JobFacts> = {}): JobFacts => ({
  status,
  hasPendingChangeOrder: false,
  hasOpenDispute: false,
  review: { exists: false, editableUntil: null },
  ...over,
});

describe('job state machine', () => {
  it.each([
    ['CREATED', 'EN_ROUTE', 'PROVIDER', 'PROVIDER_EN_ROUTE', 'enRouteAt'],
    ['CONFIRMED', 'EN_ROUTE', 'PROVIDER', 'PROVIDER_EN_ROUTE', 'enRouteAt'],
    ['PROVIDER_EN_ROUTE', 'ARRIVE', 'PROVIDER', 'PROVIDER_ARRIVED', 'arrivedAt'],
    ['PROVIDER_ARRIVED', 'START', 'PROVIDER', 'IN_PROGRESS', 'startedAt'],
    [
      'IN_PROGRESS',
      'REQUEST_COMPLETION',
      'PROVIDER',
      'AWAITING_COMPLETION_CONFIRMATION',
      'completionRequestedAt',
    ],
    ['AWAITING_COMPLETION_CONFIRMATION', 'COMPLETE', 'CUSTOMER', 'COMPLETED', 'completedAt'],
    ['AWAITING_COMPLETION_CONFIRMATION', 'DISPUTE', 'CUSTOMER', 'DISPUTED', 'disputedAt'],
    ['CREATED', 'CANCEL', 'CUSTOMER', 'CANCELLED', 'cancelledAt'],
    ['CREATED', 'CANCEL', 'PROVIDER', 'CANCELLED', 'cancelledAt'],
  ] as const)('%s --%s by %s--> %s', (from, action, party, to, stamp) => {
    expect(transitionFor(from, action, party)).toEqual({ kind: 'MOVE', from, to, stamp });
  });

  it('walks the full happy path in order', () => {
    let status: JobStatus = 'CREATED';
    const steps = [
      ['EN_ROUTE', 'PROVIDER'],
      ['ARRIVE', 'PROVIDER'],
      ['START', 'PROVIDER'],
      ['REQUEST_COMPLETION', 'PROVIDER'],
      ['COMPLETE', 'CUSTOMER'],
    ] as const;
    for (const [action, party] of steps) {
      const result = transitionFor(status, action, party);
      if (result.kind !== 'MOVE') throw new Error(`${action} from ${status}: ${result.kind}`);
      status = result.to;
    }
    expect(status).toBe('COMPLETED');
  });

  it.each([
    ['CREATED', 'ARRIVE'],
    ['CREATED', 'START'],
    ['PROVIDER_EN_ROUTE', 'START'],
    ['PROVIDER_ARRIVED', 'REQUEST_COMPLETION'],
    ['COMPLETED', 'EN_ROUTE'],
    ['CANCELLED', 'START'],
    ['DISPUTED', 'REQUEST_COMPLETION'],
  ] as const)('refuses skipping or going back: %s → %s', (from, action) => {
    expect(transitionFor(from, action, 'PROVIDER').kind).toBe('INVALID');
  });

  it('only the provider moves the work forward and only the customer confirms', () => {
    expect(transitionFor('CREATED', 'EN_ROUTE', 'CUSTOMER').kind).toBe('WRONG_PARTY');
    expect(transitionFor('PROVIDER_EN_ROUTE', 'ARRIVE', 'CUSTOMER').kind).toBe('WRONG_PARTY');
    expect(transitionFor('PROVIDER_ARRIVED', 'START', 'CUSTOMER').kind).toBe('WRONG_PARTY');
    expect(transitionFor('AWAITING_COMPLETION_CONFIRMATION', 'COMPLETE', 'PROVIDER').kind).toBe(
      'WRONG_PARTY',
    );
    expect(transitionFor('IN_PROGRESS', 'DISPUTE', 'PROVIDER').kind).toBe('WRONG_PARTY');
  });

  it('reports a repeated action as ALREADY_DONE (idempotent retry)', () => {
    expect(transitionFor('PROVIDER_EN_ROUTE', 'EN_ROUTE', 'PROVIDER')).toEqual({
      kind: 'ALREADY_DONE',
      to: 'PROVIDER_EN_ROUTE',
    });
    expect(transitionFor('COMPLETED', 'COMPLETE', 'CUSTOMER').kind).toBe('ALREADY_DONE');
  });

  it('allows cancelling only before the provider leaves', () => {
    expect(transitionFor('PROVIDER_EN_ROUTE', 'CANCEL', 'CUSTOMER').kind).toBe('INVALID');
    expect(transitionFor('IN_PROGRESS', 'CANCEL', 'PROVIDER').kind).toBe('INVALID');
    expect(transitionFor('COMPLETED', 'CANCEL', 'CUSTOMER').kind).toBe('INVALID');
  });

  it('never completes a job automatically: completion needs the customer', () => {
    expect(transitionFor('IN_PROGRESS', 'COMPLETE', 'CUSTOMER').kind).toBe('INVALID');
  });

  it('allows only "Usta gelmedi" before the provider arrives', () => {
    expect(disputeReasonAllowed('CREATED', 'NO_SHOW')).toBe(true);
    expect(disputeReasonAllowed('PROVIDER_EN_ROUTE', 'NO_SHOW')).toBe(true);
    expect(disputeReasonAllowed('PROVIDER_EN_ROUTE', 'POOR_QUALITY')).toBe(false);
    expect(disputeReasonAllowed('IN_PROGRESS', 'POOR_QUALITY')).toBe(true);
    expect(disputeReasonAllowed('AWAITING_COMPLETION_CONFIRMATION', 'OTHER')).toBe(true);
    expect(disputeReasonAllowed('COMPLETED', 'OTHER')).toBe(false);
  });

  it('keeps active and finished statuses disjoint', () => {
    const active: readonly string[] = ACTIVE_JOB_STATUSES;
    expect(FINISHED_JOB_STATUSES.some((s) => active.includes(s))).toBe(false);
  });
});

describe('availableActions', () => {
  it('offers the provider exactly one next step at each stage', () => {
    const next = (status: JobStatus) =>
      Object.entries(availableActions(facts(status), 'PROVIDER'))
        .filter(([key, on]) => on && key !== 'cancel' && key !== 'addChangeOrder')
        .map(([key]) => key);
    expect(next('CREATED')).toEqual(['enRoute']);
    expect(next('PROVIDER_EN_ROUTE')).toEqual(['arrive']);
    expect(next('PROVIDER_ARRIVED')).toEqual(['start']);
    expect(next('IN_PROGRESS')).toEqual(['requestCompletion']);
    expect(next('AWAITING_COMPLETION_CONFIRMATION')).toEqual([]);
  });

  it('hides "İşi Tamamladım" while a change order waits for an answer', () => {
    const a = availableActions(facts('IN_PROGRESS', { hasPendingChangeOrder: true }), 'PROVIDER');
    expect(a.requestCompletion).toBe(false);
    expect(a.addChangeOrder).toBe(false);
  });

  it('gives the customer confirm / report on completion request, and review after', () => {
    const waiting = availableActions(facts('AWAITING_COMPLETION_CONFIRMATION'), 'CUSTOMER');
    expect(waiting.complete).toBe(true);
    expect(waiting.dispute).toBe(true);
    expect(waiting.review).toBe(false);
    const done = availableActions(facts('COMPLETED'), 'CUSTOMER');
    expect(done.review).toBe(true);
    expect(availableActions(facts('COMPLETED'), 'PROVIDER').review).toBe(false);
  });

  it('allows editing a review only inside its window', () => {
    const now = new Date('2026-10-01T00:00:00Z');
    const open = facts('COMPLETED', {
      review: { exists: true, editableUntil: new Date('2026-10-02T00:00:00Z') },
    });
    const closed = facts('COMPLETED', {
      review: { exists: true, editableUntil: new Date('2026-09-30T00:00:00Z') },
    });
    expect(availableActions(open, 'CUSTOMER', now)).toMatchObject({
      review: false,
      editReview: true,
    });
    expect(availableActions(closed, 'CUSTOMER', now).editReview).toBe(false);
  });

  it('does not offer a second dispute while one is open', () => {
    expect(
      availableActions(facts('IN_PROGRESS', { hasOpenDispute: true }), 'CUSTOMER').dispute,
    ).toBe(false);
  });
});

describe('buildTimeline', () => {
  it('uses the real timestamps and leaves future steps empty', () => {
    const t = new Date('2026-10-01T10:00:00Z');
    const timeline = buildTimeline({
      createdAt: t,
      enRouteAt: new Date('2026-10-01T11:00:00Z'),
      arrivedAt: null,
      startedAt: null,
      completionRequestedAt: null,
      completedAt: null,
    });
    expect(timeline.map((e) => e.step)).toEqual([
      'AGREED',
      'EN_ROUTE',
      'ARRIVED',
      'STARTED',
      'COMPLETION_REQUESTED',
      'COMPLETED',
    ]);
    expect(timeline[0]?.at).toBe('2026-10-01T10:00:00.000Z');
    expect(timeline[1]?.at).toBe('2026-10-01T11:00:00.000Z');
    expect(timeline[2]?.at).toBeNull();
  });
});
