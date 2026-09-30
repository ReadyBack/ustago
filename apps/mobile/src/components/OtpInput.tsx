import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radii, spacing } from '../lib/theme';

interface Props {
  value: string;
  onChange: (code: string) => void;
  length?: number;
  /** Called once the last digit is typed (or a full code is pasted / autofilled). */
  onComplete?: (code: string) => void;
  error?: boolean;
  autoFocus?: boolean;
}

/**
 * Six boxes on screen, one real text field underneath: SMS autofill,
 * paste and screen readers all see a single "Doğrulama kodu" input.
 */
export function OtpInput({ value, onChange, length = 6, onComplete, error, autoFocus }: Props) {
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  const handle = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, length);
    onChange(digits);
    if (digits.length === length) onComplete?.(digits);
  };

  return (
    <Pressable onPress={() => input.current?.focus()} accessible={false} style={styles.wrap}>
      <View style={styles.row} pointerEvents="none" importantForAccessibility="no-hide-descendants">
        {Array.from({ length }, (_, i) => {
          const active =
            focused && (i === value.length || (i === length - 1 && value.length === length));
          return (
            <View
              key={i}
              style={[styles.box, active && styles.boxActive, error && styles.boxError]}
            >
              <Text style={styles.digit}>{value[i] ?? ''}</Text>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={input}
        testID="otp-input"
        value={value}
        onChangeText={handle}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        inputMode="numeric"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={length}
        autoFocus={autoFocus}
        accessibilityLabel="Doğrulama kodu"
        accessibilityHint={`${length} haneli kodu girin`}
        caretHidden
        style={styles.hidden}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  box: {
    flex: 1,
    aspectRatio: 0.85,
    maxWidth: 56,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxActive: { borderColor: colors.primary, borderWidth: 2 },
  boxError: { borderColor: colors.emergency },
  digit: { fontSize: 24, fontWeight: '700', color: colors.textPrimary },
  hidden: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.02,
    color: 'transparent',
    fontSize: 24,
  },
});
