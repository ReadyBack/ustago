import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { colors, radii, spacing, typography } from '../lib/theme';

type Variant = 'primary' | 'secondary' | 'danger' | 'emergency' | 'ghost';

interface Props {
  title: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  /** Screen-reader text when the title alone is not enough. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: ViewStyle;
  testID?: string;
}

const VARIANTS: Record<Variant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.primary, fg: colors.textInverse, border: colors.primary },
  secondary: { bg: colors.background, fg: colors.primary, border: colors.primary },
  danger: { bg: colors.background, fg: colors.emergency, border: colors.emergency },
  emergency: { bg: colors.emergency, fg: colors.textInverse, border: colors.emergency },
  ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
};

/** A 48pt+ button that shows a spinner and ignores taps while busy (no double submit). */
export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: Props) {
  const v = VARIANTS[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: v.bg, borderColor: v.border },
        inactive && styles.inactive,
        pressed && !inactive && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <Text style={[styles.text, { color: v.fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: typography.minTouchTarget,
    borderRadius: radii.md,
    borderWidth: 1.5,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontSize: typography.fontSizeBody, fontWeight: '600', textAlign: 'center' },
  inactive: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
