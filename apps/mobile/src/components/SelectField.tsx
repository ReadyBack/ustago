import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radii, spacing, typography } from '../lib/theme';

export interface Option<V extends string | number> {
  value: V;
  label: string;
}

interface Props<V extends string | number> {
  label: string;
  placeholder: string;
  options: Option<V>[];
  value: V | null;
  onChange: (value: V) => void;
  disabled?: boolean;
  /** Why it is disabled, read to screen readers and shown under the field. */
  disabledHint?: string;
  error?: string | null;
}

/** A searchable picker in a full-screen sheet (works the same on iOS, Android and web). */
export function SelectField<V extends string | number>({
  label,
  placeholder,
  options,
  value,
  onChange,
  disabled,
  disabledHint,
  error,
}: Props<V>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr-TR');
    return q ? options.filter((o) => o.label.toLocaleLowerCase('tr-TR').includes(q)) : options;
  }, [options, query]);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? placeholder}`}
        accessibilityHint={disabled ? disabledHint : 'Listeden seçmek için dokunun'}
        accessibilityState={{ disabled: Boolean(disabled) }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[styles.box, disabled && styles.disabled, error ? styles.boxError : null]}
      >
        <Text style={[styles.value, !selected && styles.placeholder]}>
          {selected?.label ?? placeholder}
        </Text>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {disabled && disabledHint ? <Text style={styles.hint}>{disabledHint}</Text> : null}

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle} accessibilityRole="header">
              {label}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => setOpen(false)} hitSlop={12}>
              <Text style={styles.close}>Kapat</Text>
            </Pressable>
          </View>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Ara…"
            placeholderTextColor={colors.muted}
            accessibilityLabel={`${label} ara`}
            style={styles.search}
            autoCorrect={false}
          />
          <FlatList
            data={filtered}
            keyExtractor={(o) => String(o.value)}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: item.value === value }}
                onPress={() => {
                  onChange(item.value);
                  setQuery('');
                  setOpen(false);
                }}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <Text style={[styles.rowText, item.value === value && styles.rowSelected]}>
                  {item.label}
                </Text>
                {item.value === value ? <Text style={styles.check}>✓</Text> : null}
              </Pressable>
            )}
            ListEmptyComponent={<Text style={styles.empty}>Sonuç yok</Text>}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  box: {
    minHeight: typography.minTouchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  boxError: { borderColor: colors.emergency },
  disabled: { backgroundColor: colors.surface, opacity: 0.6 },
  value: { flex: 1, fontSize: typography.fontSizeBody, color: colors.textPrimary },
  placeholder: { color: colors.muted },
  chevron: { color: colors.textSecondary, fontSize: 16 },
  error: { fontSize: 13, color: colors.emergency },
  hint: { fontSize: 13, color: colors.textSecondary },
  sheet: { flex: 1, backgroundColor: colors.background },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  close: { fontSize: 16, color: colors.primary, fontWeight: '600' },
  search: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    minHeight: typography.minTouchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontSize: typography.fontSizeBody,
    color: colors.textPrimary,
  },
  row: {
    minHeight: typography.minTouchTarget,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.surface },
  rowText: { flex: 1, fontSize: typography.fontSizeBody, color: colors.textPrimary },
  rowSelected: { color: colors.primary, fontWeight: '700' },
  check: { color: colors.primary, fontSize: 18, fontWeight: '700' },
  empty: { padding: spacing.lg, textAlign: 'center', color: colors.textSecondary },
});
