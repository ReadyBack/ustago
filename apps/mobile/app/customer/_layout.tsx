import { Tabs } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabIcon } from '../../src/components/TabIcon';
import { badgeText, useBadges } from '../../src/features/customer/useBadges';
import { colors } from '../../src/lib/theme';

export default function CustomerTabs() {
  const insets = useSafeAreaInsets();
  const badges = useBadges();
  const unreadLabel = (title: string, n: number) => (n > 0 ? `${title}, ${n} okunmamış` : title);
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        headerTitleStyle: { fontWeight: '700' },
        tabBarLabelStyle: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
        tabBarBadgeStyle: { backgroundColor: colors.emergency, fontSize: 11 },
        // Room for the emoji icon and the label, above the home indicator.
        tabBarStyle: {
          height: 70 + insets.bottom,
          paddingTop: 6,
          paddingBottom: 6 + insets.bottom,
        },
      }}
      // Switching tabs is a natural moment to refresh the counts (throttled in the hook).
      screenListeners={{ focus: badges.reload }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Ana Sayfa',
          headerShown: false,
          tabBarIcon: ({ focused }) => <TabIcon emoji="🏠" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="requests"
        options={{
          title: 'İşlerim',
          tabBarIcon: ({ focused }) => <TabIcon emoji="📋" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Mesajlar',
          tabBarBadge: badgeText(badges.messages),
          tabBarAccessibilityLabel: unreadLabel('Mesajlar', badges.messages),
          tabBarIcon: ({ focused }) => <TabIcon emoji="💬" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Bildirimler',
          tabBarBadge: badgeText(badges.notifications),
          tabBarAccessibilityLabel: unreadLabel('Bildirimler', badges.notifications),
          tabBarIcon: ({ focused }) => <TabIcon emoji="🔔" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarIcon: ({ focused }) => <TabIcon emoji="👤" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
