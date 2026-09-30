import type { UnreadNotificationCount } from '@ustago/types';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { notificationApi } from '../api/services';
import { useApi } from '../hooks/useApi';
import { colors, typography } from '../lib/theme';

/** Bell with the unread count; the in-app list is the source of truth. */
export function NotificationBell() {
  const router = useRouter();
  const unread = useApi<UnreadNotificationCount>(
    'notifications:unread',
    notificationApi.unreadCount,
    {
      pollMs: 20_000,
    },
  );
  const count = unread.data?.unread ?? 0;
  const label = count > 0 ? `Bildirimler, ${count} okunmamış` : 'Bildirimler';
  return (
    <Pressable
      testID="notification-bell"
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.push('/notifications')}
      style={styles.bell}
      hitSlop={6}
    >
      <Text style={styles.icon}>🔔</Text>
      {count > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bell: {
    minWidth: typography.minTouchTarget,
    minHeight: typography.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 24 },
  badge: {
    position: 'absolute',
    top: 4,
    right: 2,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: colors.emergency,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.textInverse, fontSize: 11, fontWeight: '800' },
});
