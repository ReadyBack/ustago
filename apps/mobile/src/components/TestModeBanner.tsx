import { StyleSheet, Text, View } from 'react-native';

import { TEST_BANNER } from '../lib/finance';
import { colors, radii, spacing } from '../lib/theme';

/** Shown whenever the API uses the test (mock) payment provider: no real money moves. */
export function TestModeBanner({ text = TEST_BANNER }: { text?: string }) {
  return (
    <View
      testID="test-mode-banner"
      style={styles.box}
      accessibilityRole="alert"
      accessibilityLabel={text}
    >
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.warningSoft,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: '#F2C46D',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm + 2,
  },
  text: { fontSize: 13, fontWeight: '800', color: '#9A6200', textAlign: 'center' },
});
