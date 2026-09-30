import { useCallback, useEffect, useRef, useState } from 'react';

import { errorMessage } from '../../api/client';
import { favoritesApi } from '../../api/customer-v2';

/**
 * Favorite heart with an optimistic update: the heart flips at once and
 * flips back, with a message, if the server refuses. PUT and DELETE are
 * idempotent, so a repeated tap is harmless.
 */
export function useFavorite(
  providerId: string,
  initial: boolean,
  onChange?: (isFavorite: boolean) => void,
) {
  const [isFavorite, setFavorite] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  // A fresh server value (refresh, other screen) wins while nothing is in flight.
  useEffect(() => {
    if (!running.current) setFavorite(initial);
  }, [initial]);

  const toggle = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    const next = !isFavorite;
    setFavorite(next);
    setError(null);
    setBusy(true);
    try {
      if (next) await favoritesApi.add(providerId);
      else await favoritesApi.remove(providerId);
      onChange?.(next);
    } catch (e) {
      setFavorite(!next);
      setError(errorMessage(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [isFavorite, providerId, onChange]);

  return { isFavorite, toggle, error, busy };
}
