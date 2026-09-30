import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '../lib/theme';

export function InfoRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, strong && styles.strong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: 2,
  },
  label: { color: colors.textSecondary, fontSize: 14 },
  value: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
  },
  strong: { fontSize: 18, fontWeight: '800' },
});
