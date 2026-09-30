import type { JobStatus, ProviderEarningStatus } from '../../generated/prisma/enums.js';

/**
 * Provider earning rules (docs/adr/0020). An online earning starts
 * PENDING; it becomes AVAILABLE only when the job is COMPLETED and the
 * hold period passed. An open dispute freezes it (HELD) until an admin
 * decides. Earnings carry no balance: amounts live in the ledger.
 */

export function holdUntil(completedAt: Date, capturedAt: Date, holdHours: number): Date {
  const base = completedAt > capturedAt ? completedAt : capturedAt;
  return new Date(base.getTime() + holdHours * 3_600_000);
}

export function canRelease(input: {
  status: ProviderEarningStatus;
  jobStatus: JobStatus;
  holdUntil: Date | null;
  now: Date;
}): boolean {
  return (
    input.status === 'PENDING' &&
    input.jobStatus === 'COMPLETED' &&
    input.holdUntil !== null &&
    input.holdUntil <= input.now
  );
}

/** Debt settled from a released earning when offsetting is on. */
export function debtToSettle(input: {
  releaseAmount: bigint;
  platformDebt: bigint;
  offsetEnabled: boolean;
}): bigint {
  if (!input.offsetEnabled || input.platformDebt <= 0n) return 0n;
  return input.platformDebt < input.releaseAmount ? input.platformDebt : input.releaseAmount;
}

/** Status for a new earning: straight to HELD on a disputed job. */
export function initialEarningStatus(jobStatus: JobStatus): ProviderEarningStatus {
  return jobStatus === 'DISPUTED' ? 'HELD' : 'PENDING';
}

/** Withdrawable now: available minus what is owed to the platform, never negative. */
export function withdrawable(available: bigint, platformDebt: bigint): bigint {
  const rest = available - (platformDebt > 0n ? platformDebt : 0n);
  return rest > 0n ? rest : 0n;
}
