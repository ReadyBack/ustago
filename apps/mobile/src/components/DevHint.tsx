import { StyleSheet, Text, View } from 'react-native';

import { IS_DEV } from '../api/config';
import { colors, radii, spacing } from '../lib/theme';

/** Developer-only help. Never rendered in a production build (__DEV__ is false there). */
export function DevHint({ children }: { children: string }) {
  if (!IS_DEV) return null;
  return (
    <View style={styles.box} accessibilityLabel={`Geliştirici notu: ${children}`}>
      <Text style={styles.tag}>DEV</Text>
      <Text style={styles.text}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.warningSoft,
    borderRadius: radii.sm,
    padding: spacing.sm + 2,
  },
  tag: { fontSize: 11, fontWeight: '800', color: '#9A6200', marginTop: 1 },
  text: { flex: 1, fontSize: 13, color: '#6B4A00', lineHeight: 18 },
});
