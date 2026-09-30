import type { BadgeCounts } from '@ustago/types';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { chatApi } from '../../api/chat';
import { useApi } from '../../hooks/useApi';

/**
 * Unread message count for the "Mesajlar" tab (GET /me/badges): reloaded
 * when the tabs come into view and every 60 s while they stay there.
 */
export function useMessageBadge(): { count: number; refresh: () => Promise<void> } {
  const badges = useApi<BadgeCounts>('me:badges', chatApi.badges, { pollMs: 60_000 });
  const { refresh } = badges;
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );
  return { count: badges.data?.messages ?? 0, refresh };
}

/** Tab badge text: undefined hides it. */
export const badgeText = (count: number): string | undefined =>
  count <= 0 ? undefined : count > 99 ? '99+' : String(count);
