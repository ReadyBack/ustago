import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../lib/theme';
import { Button } from './Button';

export function LoadingState({ label = 'Yükleniyor…' }: { label?: string }) {
  return (
    <View style={styles.center} accessibilityLiveRegion="polite">
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.body}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  icon = '📭',
  title,
  body,
  action,
}: {
  icon?: string;
  title: string;
  body?: string;
  action?: { title: string; onPress: () => void };
}) {
  return (
    <View style={styles.center}>
      <Text style={styles.icon} accessibilityElementsHidden importantForAccessibility="no">
        {icon}
      </Text>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {action ? <Button title={action.title} onPress={action.onPress} variant="secondary" /> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.center} accessibilityRole="alert">
      <Text style={styles.icon} accessibilityElementsHidden importantForAccessibility="no">
        ⚠️
      </Text>
      <Text style={styles.title}>Bir sorun oluştu</Text>
      <Text style={styles.body}>{message}</Text>
      {onRetry ? <Button title="Tekrar dene" onPress={onRetry} variant="secondary" /> : null}
    </View>
  );
}

/** Inline error under a form. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.formError} accessibilityRole="alert" accessibilityLiveRegion="assertive">
      <Text style={styles.formErrorText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
    minHeight: 240,
  },
  icon: { fontSize: 40 },
  title: {
    fontSize: typography.fontSizeBody + 2,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  body: { fontSize: 15, color: colors.textSecondary, textAlign: 'center', lineHeight: 21 },
  formError: {
    backgroundColor: colors.emergencySoft,
    borderRadius: 10,
    padding: spacing.sm + 4,
  },
  formErrorText: { color: colors.emergency, fontSize: 14, fontWeight: '500' },
});
