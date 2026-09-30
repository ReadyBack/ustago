import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '../lib/theme';
import { BrandHero } from './Brand';
import { Button } from './Button';

/** Brand splash; with `error` it offers a retry (API unreachable at start). */
export function Splash({ error, onRetry }: { error?: string | null; onRetry?: () => void }) {
  return (
    <View style={styles.container} testID="splash">
      <BrandHero iconSize={176} nameSize={36} />
      {error ? (
        <View style={styles.offline}>
          <Text style={styles.offlineText}>{error}</Text>
          {onRetry ? <Button title="Tekrar dene" onPress={onRetry} variant="secondary" /> : null}
        </View>
      ) : (
        <ActivityIndicator
          color={colors.brandOrange}
          style={styles.spinner}
          accessibilityLabel="Yükleniyor"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  spinner: { marginTop: spacing.xl },
  offline: {
    marginTop: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.md,
    maxWidth: 360,
  },
  offlineText: { color: colors.textPrimary, textAlign: 'center' },
});
