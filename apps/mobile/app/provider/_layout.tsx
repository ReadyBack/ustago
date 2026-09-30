import { Tabs } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NotificationBell } from '../../src/components/NotificationBell';
import { TabIcon } from '../../src/components/TabIcon';
import { colors } from '../../src/lib/theme';

export default function ProviderTabs() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        headerTitleStyle: { fontWeight: '700' },
        headerRight: () => <NotificationBell />,
        headerRightContainerStyle: { paddingRight: 8 },
        tabBarLabelStyle: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
        // Room for the emoji icon and the label, above the home indicator.
        tabBarStyle: {
          height: 70 + insets.bottom,
          paddingTop: 6,
          paddingBottom: 6 + insets.bottom,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'İşler',
          tabBarIcon: ({ focused }) => <TabIcon emoji="🧰" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="quotes"
        options={{
          title: 'Tekliflerim',
          tabBarIcon: ({ focused }) => <TabIcon emoji="💬" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="jobs"
        options={{
          title: 'İşlerim',
          tabBarIcon: ({ focused }) => <TabIcon emoji="📅" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: 'Kazançlarım',
          tabBarIcon: ({ focused }) => <TabIcon emoji="💰" focused={focused} />,
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
