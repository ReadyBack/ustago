import type { CategoryQuestion } from '@ustago/types';
import { StyleSheet, Text, View } from 'react-native';

import { Chip } from '../../components/Chip';
import { TextField } from '../../components/TextField';
import { colors, spacing } from '../../lib/theme';
import type { AnswerValue } from './wizard';

/** One category question in the request wizard (SINGLE/MULTI_SELECT, BOOLEAN, SHORT_TEXT, NUMBER). */
export function QuestionField({
  question: q,
  value,
  error,
  onChange,
}: {
  question: CategoryQuestion;
  value: AnswerValue | undefined;
  error?: string;
  onChange: (value: AnswerValue | undefined) => void;
}) {
  const label = `${q.label}${q.required ? ' *' : ''}`;

  if (q.type === 'SHORT_TEXT' || q.type === 'NUMBER') {
    const text = value === undefined ? '' : String(value);
    return (
      <TextField
        testID={`question-${q.key}`}
        label={label}
        hint={q.helpText ?? undefined}
        error={error}
        value={text}
        maxLength={q.type === 'NUMBER' ? 9 : 200}
        keyboardType={q.type === 'NUMBER' ? 'number-pad' : 'default'}
        inputMode={q.type === 'NUMBER' ? 'numeric' : 'text'}
        onChangeText={(t) => {
          if (t.trim() === '') return onChange(undefined);
          if (q.type === 'NUMBER') return onChange(/^-?\d+$/.test(t.trim()) ? Number(t.trim()) : t);
          return onChange(t);
        }}
      />
    );
  }

  const options =
    q.type === 'BOOLEAN'
      ? [
          { value: 'true', label: 'Evet' },
          { value: 'false', label: 'Hayır' },
        ]
      : q.options;
  const isSelected = (v: string) => {
    if (q.type === 'BOOLEAN') return value === (v === 'true');
    if (Array.isArray(value)) return value.includes(v);
    return value === v;
  };
  const press = (v: string) => {
    if (q.type === 'BOOLEAN') return onChange(isSelected(v) ? undefined : v === 'true');
    if (q.type === 'MULTI_SELECT') {
      const current = Array.isArray(value) ? value : [];
      const next = current.includes(v) ? current.filter((x) => x !== v) : [...current, v];
      return onChange(next.length > 0 ? next : undefined);
    }
    return onChange(isSelected(v) ? undefined : v);
  };

  return (
    <View
      style={styles.wrap}
      testID={`question-${q.key}`}
      accessibilityRole={q.type === 'MULTI_SELECT' ? undefined : 'radiogroup'}
    >
      <Text style={styles.label}>{label}</Text>
      {q.helpText ? <Text style={styles.hint}>{q.helpText}</Text> : null}
      {q.type === 'MULTI_SELECT' ? (
        <Text style={styles.hint}>Birden fazla seçebilirsin.</Text>
      ) : null}
      <View style={styles.chips}>
        {options.map((o) => (
          <Chip
            key={o.value}
            label={o.label}
            selected={isSelected(o.value)}
            onPress={() => press(o.value)}
          />
        ))}
      </View>
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  hint: { fontSize: 13, color: colors.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  error: { fontSize: 13, color: colors.emergency },
});
