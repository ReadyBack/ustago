import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../lib/theme';

const STARS = [1, 2, 3, 4, 5] as const;

export function starsLabel(value: number): string {
  return `5 üzerinden ${value} yıldız`;
}

/** Read-only stars; screen readers hear "5 üzerinden 4 yıldız". */
export function Stars({ value, size = 16 }: { value: number; size?: number }) {
  const full = Math.round(value);
  return (
    <Text
      accessible
      accessibilityRole="image"
      accessibilityLabel={starsLabel(Math.round(value * 10) / 10)}
      style={[styles.display, { fontSize: size }]}
    >
      {STARS.map((s) => (s <= full ? '★' : '☆')).join('')}
    </Text>
  );
}

interface InputProps {
  label: string;
  value: number | null;
  onChange: (value: number) => void;
  required?: boolean;
  testID?: string;
}

/**
 * Tap a star to rate. Each star is a 48pt target; screen readers treat the
 * row as an adjustable control ("5 üzerinden 4 yıldız", swipe up/down).
 */
export function StarInput({ label, value, onChange, required, testID }: InputProps) {
  const current = value ?? 0;
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>
        {label}
        {required ? ' *' : ''}
      </Text>
      <View
        testID={testID}
        style={styles.row}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: value ? starsLabel(value) : 'Puan verilmedi' }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'increment') onChange(Math.min(5, current + 1));
          if (e.nativeEvent.actionName === 'decrement') onChange(Math.max(1, current - 1));
        }}
      >
        {STARS.map((s) => (
          <Pressable
            key={s}
            testID={testID ? `${testID}-${s}` : undefined}
            onPress={() => onChange(s)}
            accessibilityLabel={starsLabel(s)}
            hitSlop={4}
            style={styles.star}
          >
            <Text style={[styles.starText, s <= current ? styles.on : styles.off]}>
              {s <= current ? '★' : '☆'}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  display: { color: '#F5A524', letterSpacing: 1 },
  wrap: { gap: spacing.xs },
  label: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  row: { flexDirection: 'row', gap: spacing.xs },
  star: {
    minWidth: typography.minTouchTarget,
    minHeight: typography.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  starText: { fontSize: 32 },
  on: { color: '#F5A524' },
  off: { color: colors.muted },
});
