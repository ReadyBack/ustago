import type { ProviderAvailability } from '@ustago/types';
import { createTimeOffSchema, MAX_TIME_OFF_DAYS } from '@ustago/validation';
import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { ApiError } from '../../src/api/client';
import { providerV2Api } from '../../src/api/provider-v2';
import { Badge } from '../../src/components/Badge';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Screen } from '../../src/components/Screen';
import { ErrorState, FormError, LoadingState } from '../../src/components/States';
import { Heading, Small } from '../../src/components/Text';
import { TextField } from '../../src/components/TextField';
import { AVAILABILITY_STATE, parseTrDate, trDateText } from '../../src/features/provider/labels';
import { WeeklyHoursEditor } from '../../src/features/provider/WeeklyHoursEditor';
import { useApi } from '../../src/hooks/useApi';
import { useSubmit } from '../../src/hooks/useSubmit';
import { confirm } from '../../src/lib/confirm';
import { formatDate, formatDateTime } from '../../src/lib/format';
import { colors, spacing, typography } from '../../src/lib/theme';

/** Müsaitlik: new jobs on/off, "Bugün müsait değilim", weekly hours and time off. */
export default function AvailabilitySettings() {
  const availability = useApi<ProviderAvailability>(
    'provider:availability-settings',
    providerV2Api.availability,
  );
  const settings = useSubmit(
    async (body: { acceptingNewJobs?: boolean; availableToday?: boolean }) => {
      availability.setData(await providerV2Api.updateAvailability(body));
    },
  );

  if (availability.loading) return <LoadingState />;
  if (availability.error || !availability.data) {
    return (
      <ErrorState
        message={availability.error ?? 'Müsaitlik bilgisi yüklenemedi.'}
        onRetry={availability.refresh}
      />
    );
  }
  const a = availability.data;
  const state = AVAILABILITY_STATE[a.state];

  return (
    <Screen onRefresh={availability.refresh} refreshing={availability.refreshing}>
      <Card>
        <View style={styles.rowBetween}>
          <Heading>Durum</Heading>
          <Badge label={state.label} tone={state.tone} />
        </View>
        <Small>{state.body}</Small>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Yeni iş alıyorum</Text>
          <Switch
            testID="accepting-switch"
            value={a.acceptingNewJobs}
            disabled={settings.busy}
            onValueChange={(v) => void settings.submit({ acceptingNewJobs: v })}
            accessibilityLabel="Yeni iş alıyorum"
          />
        </View>
        {a.unavailableUntil ? (
          <Button
            title="Bugün yine müsaitim"
            variant="secondary"
            loading={settings.busy}
            onPress={() => void settings.submit({ availableToday: true })}
          />
        ) : (
          <Button
            title="Bugün müsait değilim"
            variant="secondary"
            loading={settings.busy}
            onPress={() => void settings.submit({ availableToday: false })}
          />
        )}
        <FormError message={settings.error} />
        <Small>Saat dilimi: Türkiye saati</Small>
      </Card>

      <Card>
        <Heading>Çalışma saatleri</Heading>
        <WeeklyHoursEditor
          initial={a.weeklyHours}
          onSave={async (hours) => {
            availability.setData(await providerV2Api.setWeeklyHours({ hours }));
          }}
        />
      </Card>

      <TimeOffCard availability={a} onChange={availability.setData} />
    </Screen>
  );
}

function TimeOffCard({
  availability,
  onChange,
}: {
  availability: ProviderAvailability;
  onChange: (a: ProviderAvailability) => void;
}) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [note, setNote] = useState('');
  const add = useSubmit(async () => {
    const startsAt = parseTrDate(start);
    const endDay = parseTrDate(end || start);
    if (!startsAt || !endDay) {
      throw new ApiError(400, 'INVALID_DATE', 'Tarihleri GG.AA.YYYY biçiminde yazın.');
    }
    // The end day is included: the time off lasts until the next midnight.
    const endsAt = new Date(new Date(endDay).getTime() + 86_400_000).toISOString();
    const body = { startsAt, endsAt, ...(note.trim() ? { note: note.trim() } : {}) };
    const parsed = createTimeOffSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        400,
        'INVALID_TIME_OFF',
        parsed.error.issues[0]?.message ?? 'Tarihleri kontrol edin.',
      );
    }
    onChange(await providerV2Api.addTimeOff(parsed.data));
    setStart('');
    setEnd('');
    setNote('');
  });
  const remove = useSubmit(async (id: string) => {
    onChange(await providerV2Api.removeTimeOff(id));
  });

  return (
    <Card>
      <Heading>İzinler</Heading>
      <Small>
        İzindeyken sana yeni iş gönderilmez. Mevcut işlerin etkilenmez. Tek seferde en fazla{' '}
        {MAX_TIME_OFF_DAYS} gün.
      </Small>
      {availability.timeOff.length === 0 ? (
        <Small>Planlanmış iznin yok.</Small>
      ) : (
        availability.timeOff.map((t) => (
          <View key={t.id} style={styles.timeOff} testID={`time-off-${t.id}`}>
            <View style={styles.flex}>
              <Text style={styles.timeOffText}>
                {formatDateTime(t.startsAt)} – {formatDateTime(t.endsAt)}
              </Text>
              {t.note ? <Small>{t.note}</Small> : null}
              {t.current ? <Badge label="Şu an izindesin" tone="warning" /> : null}
            </View>
            <Button
              title="Sil"
              variant="ghost"
              accessibilityLabel={`${formatDate(t.startsAt)} iznini sil`}
              loading={remove.busy}
              onPress={() =>
                confirm('İzni sil', 'Bu izin kaldırılacak.', () => void remove.submit(t.id), {
                  yes: 'Sil',
                  destructive: true,
                })
              }
            />
          </View>
        ))
      )}
      <FormError message={remove.error} />
      <Heading>İzin ekle</Heading>
      <View style={styles.row}>
        <View style={styles.flex}>
          <TextField
            testID="time-off-start"
            label="İlk gün"
            placeholder={trDateText(1)}
            value={start}
            onChangeText={setStart}
            keyboardType="numbers-and-punctuation"
          />
        </View>
        <View style={styles.flex}>
          <TextField
            testID="time-off-end"
            label="Son gün (dahil)"
            placeholder={trDateText(3)}
            value={end}
            onChangeText={setEnd}
            keyboardType="numbers-and-punctuation"
          />
        </View>
      </View>
      <TextField label="Not (isteğe bağlı)" value={note} onChangeText={setNote} maxLength={200} />
      <FormError message={add.error} />
      <Button
        testID="add-time-off"
        title="İzni ekle"
        variant="secondary"
        loading={add.busy}
        disabled={!start.trim()}
        onPress={() => void add.submit()}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: typography.minTouchTarget,
  },
  switchLabel: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1, gap: 2 },
  timeOff: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingVertical: spacing.xs,
  },
  timeOffText: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
});
