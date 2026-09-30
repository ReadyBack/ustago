import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { type Edge, SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '../lib/theme';

interface Props {
  children: ReactNode;
  /** Wraps the content in a ScrollView (default true). */
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Pinned under the content (e.g. the main action), above the keyboard. */
  footer?: ReactNode;
  edges?: Edge[];
  contentStyle?: ViewStyle;
}

/** Safe area, keyboard avoidance, pull-to-refresh and a pinned footer in one place. */
export function Screen({
  children,
  scroll = true,
  refreshing = false,
  onRefresh,
  footer,
  edges = ['bottom'],
  contentStyle,
}: Props) {
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.content, contentStyle]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.content, styles.fill, contentStyle]}>{children}</View>
  );
  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {content}
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  fill: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.md, flexGrow: 1 },
  footer: {
    padding: spacing.md,
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
});
