import type { ProviderVerificationStatus } from '../../generated/prisma/client.js';

/**
 * Provider account verification (Faz 6, docs/adr/0023). One case per
 * provider; no row means NOT_STARTED.
 *
 *   NOT_STARTED ─UPLOAD─▶ IN_PROGRESS ─SUBMIT─▶ SUBMITTED ─START_REVIEW─▶ UNDER_REVIEW
 *   UNDER_REVIEW ─APPROVE─▶ VERIFIED ─SUSPEND─▶ SUSPENDED ─REINSTATE─▶ VERIFIED
 *   UNDER_REVIEW ─REQUEST_REVISION─▶ NEEDS_REVISION ─SUBMIT─▶ SUBMITTED
 *   UNDER_REVIEW ─REJECT─▶ REJECTED ─RESTART─▶ IN_PROGRESS
 *   SUSPENDED ─START_REVIEW─▶ UNDER_REVIEW (re-check after a document issue)
 *
 * Approval needs UNDER_REVIEW: an admin takes the case ("İncelemeye Al")
 * before deciding, so two admins cannot decide the same submission blind.
 * Anything else is 409 PROVIDER_VERIFICATION_INVALID_TRANSITION.
 */
export type VerificationEvent =
  | 'UPLOAD'
  | 'SUBMIT'
  | 'START_REVIEW'
  | 'APPROVE'
  | 'REQUEST_REVISION'
  | 'REJECT'
  | 'RESTART'
  | 'SUSPEND'
  | 'REINSTATE';

const TRANSITIONS: Record<
  VerificationEvent,
  { from: readonly ProviderVerificationStatus[]; to: ProviderVerificationStatus }
> = {
  UPLOAD: { from: ['NOT_STARTED'], to: 'IN_PROGRESS' },
  SUBMIT: { from: ['NOT_STARTED', 'IN_PROGRESS', 'NEEDS_REVISION'], to: 'SUBMITTED' },
  START_REVIEW: { from: ['SUBMITTED', 'SUSPENDED'], to: 'UNDER_REVIEW' },
  APPROVE: { from: ['UNDER_REVIEW'], to: 'VERIFIED' },
  REQUEST_REVISION: { from: ['UNDER_REVIEW'], to: 'NEEDS_REVISION' },
  REJECT: { from: ['UNDER_REVIEW'], to: 'REJECTED' },
  RESTART: { from: ['REJECTED'], to: 'IN_PROGRESS' },
  SUSPEND: { from: ['VERIFIED'], to: 'SUSPENDED' },
  REINSTATE: { from: ['SUSPENDED'], to: 'VERIFIED' },
};

export function verificationTransition(
  from: ProviderVerificationStatus,
  event: VerificationEvent,
): ProviderVerificationStatus | null {
  const rule = TRANSITIONS[event];
  return rule.from.includes(from) ? rule.to : null;
}

export function verificationSources(
  event: VerificationEvent,
): readonly ProviderVerificationStatus[] {
  return TRANSITIONS[event].from;
}

/** The provider may add or replace documents. */
export function canEditDocuments(status: ProviderVerificationStatus): boolean {
  return (
    status === 'NOT_STARTED' ||
    status === 'IN_PROGRESS' ||
    status === 'NEEDS_REVISION' ||
    status === 'REJECTED' ||
    status === 'VERIFIED'
  );
}

/** Admin queue filter values → statuses. */
export const REVIEWABLE: readonly ProviderVerificationStatus[] = ['SUBMITTED', 'UNDER_REVIEW'];
