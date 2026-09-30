import type { WeeklyHoursInterval } from '@ustago/types';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { FormError } from '../../components/States';
import { Small } from '../../components/Text';
import { useSubmit } from '../../hooks/useSubmit';
import { ApiError } from '../../api/client';
import { colors, radii, spacing, typography } from '../../lib/theme';
import { WEEKDAYS } from './labels';
import { buildWeeklyHours, draftKey, type IntervalDraft, toDrafts } from './weekly-hours';

/** Weekly hours per weekday: add/remove intervals, checked before saving. */
export function WeeklyHoursEditor({
  initial,
  onSave,
}: {
  initial: readonly WeeklyHoursInterval[];
  onSave: (hours: WeeklyHoursInterval[]) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<IntervalDraft[]>(() => toDrafts(initial));
  const [saved, setSaved] = useState(false);
  const save = useSubmit(async () => {
    const built = buildWeeklyHours(drafts);
    if (!built.ok) throw new ApiError(400, 'INVALID_HOURS', built.error);
    await onSave(built.body.hours);
    setSaved(true);
  });

  const update = (key: string, patch: Partial<IntervalDraft>) => {
    setSaved(false);
    setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  };
  const add = (weekday: number) => {
    setSaved(false);
    setDrafts((list) => [...list, { key: draftKey(), weekday, start: '09:00', end: '18:00' }]);
  };
  const remove = (key: string) => {
    setSaved(false);
    setDrafts((list) => list.filter((d) => d.key !== key));
  };
  const fillWeekdays = () => {
    setSaved(false);
    setDrafts(
      [1, 2, 3, 4, 5].map((weekday) => ({
        key: draftKey(),
        weekday,
        start: '09:00',
        end: '18:00',
      })),
    );
  };

  return (
    <View style={styles.wrap}>
      <Small>
        Saatler Türkiye saatidir. Hiç saat girmezsen esnek çalışıyor sayılırsın. Çalışma saatleri
        dışında da teklif istekleri gelir.
      </Small>
      {drafts.length === 0 ? (
        <Button title="Hafta içi 09:00–18:00 ile başla" variant="ghost" onPress={fillWeekdays} />
      ) : null}
      {WEEKDAYS.map((day) => {
        const rows = drafts.filter((d) => d.weekday === day.value);
        return (
          <View key={day.value} style={styles.day} testID={`weekday-${day.value}`}>
            <View style={styles.dayHeader}>
              <Text style={styles.dayName}>{day.label}</Text>
              {rows.length === 0 ? <Small>Kapalı</Small> : null}
            </View>
            {rows.map((r) => (
              <View key={r.key} style={styles.intervalRow}>
                <TextInput
                  testID={`start-${r.key}`}
                  accessibilityLabel={`${day.label} başlangıç saati`}
                  value={r.start}
                  onChangeText={(t) => update(r.key, { start: t })}
                  placeholder="09:00"
                  placeholderTextColor={colors.muted}
                  keyboardType="numbers-and-punctuation"
                  style={styles.time}
                  maxLength={5}
                />
                <Text style={styles.dash}>–</Text>
                <TextInput
                  testID={`end-${r.key}`}
                  accessibilityLabel={`${day.label} bitiş saati`}
                  value={r.end}
                  onChangeText={(t) => update(r.key, { end: t })}
                  placeholder="18:00"
                  placeholderTextColor={colors.muted}
                  keyboardType="numbers-and-punctuation"
                  style={styles.time}
                  maxLength={5}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${day.label} ${r.start}–${r.end} aralığını sil`}
                  onPress={() => remove(r.key)}
                  style={styles.remove}
                >
                  <Text style={styles.removeText}>Sil</Text>
                </Pressable>
              </View>
            ))}
            <Pressable
              testID={`add-${day.value}`}
              accessibilityRole="button"
              accessibilityLabel={`${day.label} için saat aralığı ekle`}
              onPress={() => add(day.value)}
              style={styles.add}
            >
              <Text style={styles.addText}>+ Aralık ekle</Text>
            </Pressable>
          </View>
        );
      })}
      <FormError message={save.error} />
      {saved ? (
        <Text style={styles.saved} accessibilityLiveRegion="polite">
          Çalışma saatlerin kaydedildi.
        </Text>
      ) : null}
      <Button
        testID="save-weekly-hours"
        title="Çalışma saatlerini kaydet"
        loading={save.busy}
        onPress={() => void save.submit()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  day: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  dayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dayName: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  intervalRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  time: {
    width: 84,
    minHeight: typography.minTouchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    textAlign: 'center',
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  dash: { fontSize: 16, color: colors.textSecondary },
  remove: {
    minHeight: typography.minTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  removeText: { color: colors.emergency, fontWeight: '700', fontSize: 14 },
  add: { minHeight: typography.minTouchTarget, justifyContent: 'center', alignSelf: 'flex-start' },
  addText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  saved: { color: colors.success, fontWeight: '600' },
});
