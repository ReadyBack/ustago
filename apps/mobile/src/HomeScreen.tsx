import { colors, spacing, typography } from '@ustago/ui';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

export function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        UstaGO
      </Text>
      <Text style={styles.subtitle}>Güvenilir usta, hızlıca kapında.</Text>
      <StatusBar style="auto" />
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
    gap: spacing.sm,
  },
  title: {
    fontSize: typography.fontSizeHeadline,
    fontWeight: '700',
    color: colors.primary,
  },
  subtitle: {
    fontSize: typography.fontSizeBody,
    color: colors.textSecondary,
  },
});
