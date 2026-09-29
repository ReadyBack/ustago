import type { ProviderStatus } from '../../generated/prisma/client.js';

/**
 * Provider application lifecycle (docs/adr/0010). Every status change goes
 * through transitionFor(); services never write `status` directly from a
 * request.
 *
 *   DRAFT ──SUBMIT──▶ PENDING_REVIEW ──APPROVE──▶ ACTIVE ◀──REINSTATE── SUSPENDED
 *     ▲                     │                        └──────SUSPEND──────▶
 *     └──REAPPLY── REJECTED ◀──REJECT──┘
 */
export type ProviderEvent = 'SUBMIT' | 'APPROVE' | 'REJECT' | 'REAPPLY' | 'SUSPEND' | 'REINSTATE';

const TRANSITIONS: Record<ProviderEvent, { from: readonly ProviderStatus[]; to: ProviderStatus }> =
  {
    SUBMIT: { from: ['DRAFT'], to: 'PENDING_REVIEW' },
    APPROVE: { from: ['PENDING_REVIEW'], to: 'ACTIVE' },
    REJECT: { from: ['PENDING_REVIEW'], to: 'REJECTED' },
    REAPPLY: { from: ['REJECTED'], to: 'DRAFT' },
    SUSPEND: { from: ['ACTIVE'], to: 'SUSPENDED' },
    REINSTATE: { from: ['SUSPENDED'], to: 'ACTIVE' },
  };

/** Target status, or null when the event is not allowed from `from`. */
export function transitionFor(from: ProviderStatus, event: ProviderEvent): ProviderStatus | null {
  const rule = TRANSITIONS[event];
  return rule.from.includes(from) ? rule.to : null;
}

/** Statuses an event may start from; used for conditional (race-safe) updates. */
export function sourceStatuses(event: ProviderEvent): readonly ProviderStatus[] {
  return TRANSITIONS[event].from;
}

export type ProviderSection =
  'PROFILE' | 'SERVICES' | 'SERVICE_AREAS' | 'VERIFICATIONS' | 'NOW_PREFERENCE';

/**
 * What the provider may change in each status. While PENDING_REVIEW the
 * application is frozen so the admin reviews exactly what was submitted;
 * a SUSPENDED provider cannot change anything until reinstated.
 */
const EDITABLE: Record<ProviderStatus, readonly ProviderSection[]> = {
  DRAFT: ['PROFILE', 'SERVICES', 'SERVICE_AREAS', 'VERIFICATIONS', 'NOW_PREFERENCE'],
  REJECTED: ['PROFILE', 'SERVICES', 'SERVICE_AREAS', 'VERIFICATIONS', 'NOW_PREFERENCE'],
  PENDING_REVIEW: [],
  ACTIVE: ['PROFILE', 'SERVICES', 'SERVICE_AREAS', 'VERIFICATIONS', 'NOW_PREFERENCE'],
  SUSPENDED: [],
};

export function canEdit(status: ProviderStatus, section: ProviderSection): boolean {
  return EDITABLE[status].includes(section);
}

/**
 * Real-time availability for dispatch. Only an approved (ACTIVE) provider
 * can be offered NOW jobs; a pending application may store the preference
 * but never becomes dispatchable.
 */
export function canBeAvailableNow(status: ProviderStatus): boolean {
  return status === 'ACTIVE';
}

/** Statuses in which services and areas must not become empty. */
export function requiresNonEmptyCatalog(status: ProviderStatus): boolean {
  return status === 'ACTIVE';
}
