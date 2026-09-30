import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '../lib/theme';
import { Button } from './Button';

/** Brand splash; with `error` it offers a retry (API unreachable at start). */
export function Splash({ error, onRetry }: { error?: string | null; onRetry?: () => void }) {
  return (
    <View style={styles.container} testID="splash">
      <Text style={styles.logo} accessibilityRole="header">
        Usta<Text style={styles.logoAccent}>GO</Text>
      </Text>
      <Text style={styles.slogan}>İşini şimdi çözdür.</Text>
      {error ? (
        <View style={styles.offline}>
          <Text style={styles.offlineText}>{error}</Text>
          {onRetry ? <Button title="Tekrar dene" onPress={onRetry} variant="secondary" /> : null}
        </View>
      ) : (
        <ActivityIndicator
          color={colors.textInverse}
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
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  logo: { fontSize: 48, fontWeight: '900', color: colors.textInverse, letterSpacing: -1 },
  logoAccent: { color: '#FFD166' },
  slogan: { fontSize: 18, color: colors.textInverse, marginTop: spacing.sm, opacity: 0.95 },
  spinner: { marginTop: spacing.xl },
  offline: {
    marginTop: spacing.xl,
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.md,
    maxWidth: 360,
  },
  offlineText: { color: colors.textPrimary, textAlign: 'center' },
});
