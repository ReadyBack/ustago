import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { colors, radii, spacing } from '../lib/theme';

interface Props {
  children: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: ViewStyle;
  highlight?: 'emergency' | 'success' | 'primary';
  testID?: string;
}

export function Card({ children, onPress, accessibilityLabel, style, highlight, testID }: Props) {
  const border = highlight
    ? {
        borderColor:
          highlight === 'emergency'
            ? colors.emergency
            : highlight === 'success'
              ? colors.success
              : colors.primary,
        borderWidth: 1.5,
      }
    : null;
  if (!onPress) {
    return (
      <View testID={testID} style={[styles.card, border, style]}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.card, border, pressed && styles.pressed, style]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.background,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  pressed: { opacity: 0.8 },
});
