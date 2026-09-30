import type { ReactNode } from 'react';
import { StyleSheet, Text, type TextStyle } from 'react-native';

import { colors, typography } from '../lib/theme';

export function Title({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return (
    <Text accessibilityRole="header" style={[styles.title, style]}>
      {children}
    </Text>
  );
}

export function Heading({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return (
    <Text accessibilityRole="header" style={[styles.heading, style]}>
      {children}
    </Text>
  );
}

export function Body({
  children,
  style,
  muted,
}: {
  children: ReactNode;
  style?: TextStyle;
  muted?: boolean;
}) {
  return <Text style={[styles.body, muted && styles.muted, style]}>{children}</Text>;
}

export function Small({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return <Text style={[styles.small, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  title: { fontSize: typography.fontSizeTitle, fontWeight: '800', color: colors.textPrimary },
  heading: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
  body: { fontSize: 15, color: colors.textPrimary, lineHeight: 21 },
  muted: { color: colors.textSecondary },
  small: { fontSize: 13, color: colors.textSecondary },
});
