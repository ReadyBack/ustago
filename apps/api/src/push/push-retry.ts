/**
 * Retry policy for push deliveries (docs/adr/0017): exponential backoff
 * from 30 seconds, capped at one hour, and a hard attempt limit so a
 * broken delivery never retries forever.
 */
const BASE_SECONDS = 30;
const MAX_SECONDS = 60 * 60;

/** Delay before attempt `attempt + 1`, after `attempt` failed attempts (1-based). */
export function backoffSeconds(attempt: number): number {
  return Math.min(MAX_SECONDS, BASE_SECONDS * 2 ** Math.max(0, attempt - 1));
}

export type RetryDecision = { retry: true; nextAttemptAt: Date } | { retry: false };

export function retryDecision(attemptsMade: number, maxAttempts: number, now: Date): RetryDecision {
  if (attemptsMade >= maxAttempts) return { retry: false };
  return {
    retry: true,
    nextAttemptAt: new Date(now.getTime() + backoffSeconds(attemptsMade) * 1000),
  };
}

/** How long a claimed delivery is hidden from other workers while it is being sent. */
export const CLAIM_LEASE_SECONDS = 120;
