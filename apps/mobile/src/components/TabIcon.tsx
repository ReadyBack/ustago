import { Text } from 'react-native';

export function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return (
    <Text
      style={{ fontSize: 20, lineHeight: 24, opacity: focused ? 1 : 0.55 }}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {emoji}
    </Text>
  );
}
