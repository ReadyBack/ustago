import type { PenaltySeverity } from '@ustago/types';

import type {
  DisciplinaryActionStatus,
  DisciplinaryActionType,
} from '../../generated/prisma/client.js';

/**
 * Sanctions (docs/adr/0016). Always decided by an admin with a reason,
 * never produced automatically by a review, an open dispute or a single
 * complaint. Faz 4 applies the ranking effect only; account suspension is
 * the separate provider review flow.
 */
const SEVERITY: Record<DisciplinaryActionType, PenaltySeverity> = {
  WARNING: 'WARNING',
  VISIBILITY_REDUCTION: 'MINOR',
  NOW_SUSPENSION: 'MAJOR',
  JOB_RESTRICTION: 'MAJOR',
  TEMPORARY_SUSPENSION: 'CRITICAL',
  PERMANENT_BAN: 'CRITICAL',
};

export function severityOf(type: DisciplinaryActionType): PenaltySeverity {
  return SEVERITY[type];
}

/**
 * UstaScore points an active sanction takes off. CRITICAL takes none here:
 * a suspended provider is not listed at all, and that is an explicit admin
 * decision on the account, not a score effect.
 */
export const PENALTY_POINTS: Record<PenaltySeverity, number> = {
  WARNING: 2,
  MINOR: 10,
  MAJOR: 20,
  CRITICAL: 0,
};

/** Several sanctions never push a score below what one strong penalty would. */
export const MAX_PENALTY_POINTS = 40;

/** A sanction under appeal still applies until the appeal is decided. */
const IN_FORCE: readonly DisciplinaryActionStatus[] = ['ACTIVE', 'UNDER_APPEAL'];

export interface PenaltyWindow {
  type: DisciplinaryActionType;
  status: DisciplinaryActionStatus;
  startsAt: Date;
  endsAt: Date | null;
}

export function isInForce(p: PenaltyWindow, now = new Date()): boolean {
  return IN_FORCE.includes(p.status) && p.startsAt <= now && (p.endsAt === null || p.endsAt > now);
}

export function penaltyPoints(penalties: readonly PenaltyWindow[], now = new Date()): number {
  const total = penalties
    .filter((p) => isInForce(p, now))
    .reduce((sum, p) => sum + PENALTY_POINTS[severityOf(p.type)], 0);
  return Math.min(total, MAX_PENALTY_POINTS);
}

/** NOW (emergency) jobs are withheld while a NOW suspension is in force. */
export function blocksNow(penalties: readonly PenaltyWindow[], now = new Date()): boolean {
  return penalties.some((p) => p.type === 'NOW_SUSPENSION' && isInForce(p, now));
}
