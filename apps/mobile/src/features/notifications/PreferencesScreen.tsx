import type { NotificationPreferences } from '@ustago/types';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { notificationV2Api } from '../../api/customer-v2';
import { errorMessage } from '../../api/client';
import { Badge } from '../../components/Badge';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { ErrorState, FormError, LoadingState } from '../../components/States';
import { Body, Heading, Small } from '../../components/Text';
import { useApi } from '../../hooks/useApi';
import { colors, radii, spacing, typography } from '../../lib/theme';

type Editable = Partial<
  Pick<
    NotificationPreferences,
    'quoteUpdatesPush' | 'newMessagePush' | 'marketingPush' | 'quietHoursStart' | 'quietHoursEnd'
  >
>;

const DEFAULT_QUIET = { start: 22 * 60, end: 8 * 60 };
const STEP = 30;

export function minutesLabel(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const wrap = (m: number) => ((m % 1440) + 1440) % 1440;

/** Push preferences. Job and payment notifications are transactional and cannot be turned off. */
export function NotificationPreferencesScreen() {
  const prefs = useApi<NotificationPreferences>(
    'notification-preferences',
    notificationV2Api.preferences,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (prefs.loading) return <LoadingState />;
  if (prefs.error || !prefs.data) {
    return <ErrorState message={prefs.error ?? 'Tercihler yüklenemedi.'} onRetry={prefs.refresh} />;
  }
  const p = prefs.data;
  const quietOn = p.quietHoursStart !== null && p.quietHoursEnd !== null;

  /** Optimistic: the switch moves at once and moves back if the server refuses. */
  const save = async (patch: Editable) => {
    const before = p;
    prefs.setData({ ...p, ...patch });
    setError(null);
    setSaving(true);
    try {
      prefs.setData(await notificationV2Api.updatePreferences(patch));
    } catch (e) {
      prefs.setData(before);
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const shift = (which: 'start' | 'end', delta: number) => {
    if (!quietOn) return;
    let start = p.quietHoursStart ?? DEFAULT_QUIET.start;
    let end = p.quietHoursEnd ?? DEFAULT_QUIET.end;
    if (which === 'start') start = wrap(start + delta);
    else end = wrap(end + delta);
    // Start and end may not be equal; skip over the other value.
    if (start === end) {
      if (which === 'start') start = wrap(start + delta);
      else end = wrap(end + delta);
    }
    void save({ quietHoursStart: start, quietHoursEnd: end });
  };

  return (
    <Screen>
      <Card>
        <Heading>Push bildirimleri</Heading>
        <Row
          label="İş güncellemeleri"
          hint="Ustanın yola çıkması, varışı, ek iş onayı ve tamamlama"
          value
          locked
        />
        <Row label="Ödeme ve iade" hint="Ödeme, iade ve para çekme durumu" value locked />
        <Row
          testID="pref-quote-updates"
          label="Teklif güncellemeleri"
          hint="Yeni teklif ve pazarlık adımları"
          value={p.quoteUpdatesPush}
          onChange={(v) => void save({ quoteUpdatesPush: v })}
        />
        <Row
          testID="pref-new-message"
          label="Yeni mesaj"
          hint="Ustalardan gelen mesajlar"
          value={p.newMessagePush}
          onChange={(v) => void save({ newMessagePush: v })}
        />
        <Row
          testID="pref-marketing"
          label="Kampanya ve duyurular"
          value={p.marketingPush}
          onChange={(v) => void save({ marketingPush: v })}
        />
        <Small>
          Kapattığın bildirimler uygulamadaki Bildirimler sekmesinde görünmeye devam eder.
        </Small>
      </Card>

      <Card>
        <Heading>Sessiz saatler</Heading>
        <Row
          testID="pref-quiet-hours"
          label="Sessiz saatleri kullan"
          value={quietOn}
          onChange={(v) =>
            void save(
              v
                ? { quietHoursStart: DEFAULT_QUIET.start, quietHoursEnd: DEFAULT_QUIET.end }
                : { quietHoursStart: null, quietHoursEnd: null },
            )
          }
        />
        {quietOn ? (
          <>
            <TimeStepper
              label="Başlangıç"
              minutes={p.quietHoursStart ?? DEFAULT_QUIET.start}
              onChange={(d) => shift('start', d)}
              disabled={saving}
            />
            <TimeStepper
              label="Bitiş"
              minutes={p.quietHoursEnd ?? DEFAULT_QUIET.end}
              onChange={(d) => shift('end', d)}
              disabled={saving}
            />
          </>
        ) : null}
        <Body muted>
          Sessiz saatlerde teklif ve mesaj bildirimleri telefonuna gönderilmez; uygulamada yine
          görünür. İş ve ödeme bildirimleri zorunludur, her zaman gelir. Saatler Türkiye saatidir.
        </Body>
      </Card>
      <FormError message={error} />
    </Screen>
  );
}

function Row({
  label,
  hint,
  value,
  onChange,
  locked,
  testID,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange?: (v: boolean) => void;
  locked?: boolean;
  testID?: string;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.flex}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Small>{hint}</Small> : null}
        {locked ? <Badge label="Zorunlu" tone="neutral" /> : null}
      </View>
      <Switch
        testID={testID}
        value={value}
        disabled={locked}
        onValueChange={onChange}
        accessibilityLabel={locked ? `${label}, zorunlu, kapatılamaz` : label}
      />
    </View>
  );
}

function TimeStepper({
  label,
  minutes,
  onChange,
  disabled,
}: {
  label: string;
  minutes: number;
  onChange: (delta: number) => void;
  disabled?: boolean;
}) {
  const value = minutesLabel(minutes);
  return (
    <View style={styles.row}>
      <Text style={styles.label} accessibilityLabel={`${label}: ${value}`}>
        {label}
      </Text>
      <View style={styles.stepper}>
        <StepButton
          text="−"
          label={`${label} 30 dakika geri`}
          onPress={() => onChange(-STEP)}
          disabled={disabled}
        />
        <Text style={styles.time}>{value}</Text>
        <StepButton
          text="+"
          label={`${label} 30 dakika ileri`}
          onPress={() => onChange(STEP)}
          disabled={disabled}
        />
      </View>
    </View>
  );
}

function StepButton({
  text,
  label,
  onPress,
  disabled,
}: {
  text: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.step,
        pressed && { opacity: 0.7 },
        disabled && { opacity: 0.5 },
      ]}
    >
      <Text style={styles.stepText}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: typography.minTouchTarget,
  },
  flex: { flex: 1, gap: 2 },
  label: { fontSize: 16, color: colors.textPrimary, fontWeight: '500' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  step: {
    width: typography.minTouchTarget,
    height: typography.minTouchTarget,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  stepText: { fontSize: 22, fontWeight: '700', color: colors.primary },
  time: {
    fontSize: 18,
    fontWeight: '700',
    minWidth: 64,
    textAlign: 'center',
    color: colors.textPrimary,
  },
});
