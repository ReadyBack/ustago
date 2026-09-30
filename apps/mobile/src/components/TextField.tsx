import { forwardRef } from 'react';
import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';

import { colors, radii, spacing, typography } from '../lib/theme';

interface Props extends TextInputProps {
  label: string;
  error?: string | null;
  hint?: string;
  /** Shown before the input, e.g. "+90" or "₺". */
  prefix?: string;
}

export const TextField = forwardRef<TextInput, Props>(function TextField(
  { label, error, hint, prefix, style, multiline, ...rest },
  ref,
) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.box, error ? styles.boxError : null, multiline && styles.multiline]}>
        {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={hint}
          placeholderTextColor={colors.muted}
          style={[styles.input, multiline && styles.inputMultiline, style]}
          multiline={multiline}
          {...rest}
        />
      </View>
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: typography.minTouchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
  },
  boxError: { borderColor: colors.emergency },
  multiline: { alignItems: 'flex-start', paddingVertical: spacing.sm },
  prefix: {
    fontSize: typography.fontSizeBody,
    color: colors.textSecondary,
    marginRight: spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: typography.fontSizeBody,
    color: colors.textPrimary,
    paddingVertical: 10,
  },
  inputMultiline: { minHeight: 96, textAlignVertical: 'top' },
  error: { fontSize: 13, color: colors.emergency },
  hint: { fontSize: 13, color: colors.textSecondary },
});
