import { useCallback, useRef, useState } from 'react';

import { errorMessage } from '../api/client';

/**
 * Wraps an async action so a second tap while it runs is ignored (the
 * server is idempotent or conflict-safe anyway; this keeps the UI calm).
 */
export function useSubmit<A extends unknown[], R>(action: (...args: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const submit = useCallback(
    async (...args: A): Promise<R | undefined> => {
      if (running.current) return undefined;
      running.current = true;
      setBusy(true);
      setError(null);
      try {
        return await action(...args);
      } catch (e) {
        setError(errorMessage(e));
        return undefined;
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [action],
  );

  return { submit, busy, error, setError };
}
