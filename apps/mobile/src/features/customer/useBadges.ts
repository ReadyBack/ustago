import type { BadgeCounts } from '@ustago/types';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { homeApi } from '../../api/customer-v2';

const POLL_MS = 60_000;
/** Focus changes closer together than this reuse the last answer. */
const MIN_GAP_MS = 10_000;

type Listener = () => void;
const listeners = new Set<Listener>();

/** Ask every mounted badge hook to reload now (e.g. after "Tümünü okundu işaretle"). */
export function refreshBadges() {
  for (const l of listeners) l();
}

/**
 * Unread counts for the Mesajlar and Bildirimler tabs from GET /me/badges.
 * Gentle: on focus, then every 60 s while focused; failures keep the last
 * known counts (a badge is a hint, the lists are the source of truth).
 */
export function useBadges(): BadgeCounts & { reload: () => void } {
  const [counts, setCounts] = useState<BadgeCounts>({ notifications: 0, messages: 0 });
  const last = useRef(0);
  const seq = useRef(0);

  const load = useCallback((force: boolean) => {
    const now = Date.now();
    if (!force && now - last.current < MIN_GAP_MS) return;
    last.current = now;
    const id = ++seq.current;
    homeApi.badges().then(
      (b) => {
        if (id === seq.current) setCounts(b);
      },
      () => undefined,
    );
  }, []);

  useEffect(() => {
    const l = () => load(true);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load(false);
      const timer = setInterval(() => load(true), POLL_MS);
      return () => clearInterval(timer);
    }, [load]),
  );

  const reload = useCallback(() => load(false), [load]);
  return { ...counts, reload };
}

export function badgeText(n: number): string | undefined {
  if (n <= 0) return undefined;
  return n > 99 ? '99+' : String(n);
}
