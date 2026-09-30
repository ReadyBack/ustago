import { Tabs } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        // Room for the emoji icon and the label, above the home indicator.
        tabBarStyle: {
          height: 62 + insets.bottom,
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
        name="profile"
        options={{
          title: 'Profil',
          tabBarIcon: ({ focused }) => <TabIcon emoji="👤" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
