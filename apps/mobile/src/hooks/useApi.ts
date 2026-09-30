import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { errorMessage } from '../api/client';

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  /** First load of the current key (no data for it yet). */
  loading: boolean;
  /** Pull-to-refresh in progress. */
  refreshing: boolean;
  refresh: () => Promise<void>;
  setData: (data: T) => void;
}

/**
 * Loads data for `key` (e.g. "request:<id>"; a new key reloads, an empty
 * key loads nothing), supports pull-to-refresh, and optionally polls while
 * the screen is focused: push is only a best-effort nudge,
 * so polling keeps lists fresh. Out-of-order responses are dropped.
 */
export function useApi<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: { pollMs?: number; enabled?: boolean } = {},
): ApiState<T> {
  const { pollMs } = options;
  const enabled = (options.enabled ?? true) && key !== '';
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  /** Fetches and stores the result; `quiet` keeps the last good data on failure. */
  const load = useCallback(
    (quiet: boolean): Promise<void> => {
      const id = ++seq.current;
      return fetcherRef.current().then(
        (result) => {
          if (id !== seq.current) return;
          setData(result);
          setError(null);
          setLoadedKey(key);
        },
        (e: unknown) => {
          if (id !== seq.current) return;
          if (!quiet) setError(errorMessage(e));
          setLoadedKey(key);
        },
      );
    },
    [key],
  );

  useEffect(() => {
    if (enabled) void load(false);
  }, [enabled, load]);

  useFocusEffect(
    useCallback(() => {
      if (!pollMs || !enabled) return undefined;
      const timer = setInterval(() => void load(true), pollMs);
      return () => clearInterval(timer);
    }, [load, pollMs, enabled]),
  );

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setRefreshing(true);
    try {
      await load(false);
    } finally {
      setRefreshing(false);
    }
  }, [enabled, load]);

  return { data, error, loading: enabled && loadedKey !== key, refreshing, refresh, setData };
}
