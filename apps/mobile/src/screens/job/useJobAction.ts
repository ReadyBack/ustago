import type { Job } from '@ustago/types';
import { useCallback } from 'react';

import type { ApiState } from '../../hooks/useApi';
import { useSubmit } from '../../hooks/useSubmit';
import { isStaleJobError, toJobError } from '../../lib/job-errors';

/**
 * Runs a job action and shows the server's answer, never an optimistic
 * guess. When the job moved elsewhere (409), the screen reloads so the
 * right action is on screen, and the message explains why.
 */
export function useJobAction<A extends unknown[]>(
  job: ApiState<Job>,
  /** Resolves to the updated job, or to null when the screen should reload it. */
  action: (...args: A) => Promise<Job | null>,
) {
  const run = useCallback(
    async (...args: A) => {
      try {
        const next = await action(...args);
        if (next) job.setData(next);
        else await job.refresh();
      } catch (e) {
        if (isStaleJobError(e)) await job.refresh();
        throw toJobError(e);
      }
    },
    [action, job],
  );
  return useSubmit(run);
}
