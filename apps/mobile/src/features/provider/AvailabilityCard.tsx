import type { ProviderAvailability, ProviderProfile } from '@ustago/types';
import { useRouter } from 'expo-router';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { providerV2Api } from '../../api/provider-v2';
import { providerApi } from '../../api/services';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { FormError } from '../../components/States';
import { Heading, Small } from '../../components/Text';
import { useSubmit } from '../../hooks/useSubmit';
import { formatDateTime } from '../../lib/format';
import { colors, spacing, typography } from '../../lib/theme';
import { AVAILABILITY_STATE } from './labels';

/**
 * Quick availability controls: "Yeni iş alıyorum", "Bugün müsait değilim"
 * (both PATCH /providers/me/availability-settings) and the NOW "Müsaitim"
 * switch, which stays on the Faz 3 endpoint.
 */
export function AvailabilityCard({
  availability,
  profile,
  nowBlocked,
  onAvailability,
  onProfile,
}: {
  availability: ProviderAvailability;
  profile: ProviderProfile | null;
  /** Unverified or restricted accounts cannot take NOW jobs. */
  nowBlocked: boolean;
  onAvailability: (a: ProviderAvailability) => void;
  onProfile: (p: ProviderProfile) => void;
}) {
  const router = useRouter();
  const a = availability;
  const state = AVAILABILITY_STATE[a.state];
  const settings = useSubmit(
    async (body: { acceptingNewJobs?: boolean; availableToday?: boolean }) => {
      onAvailability(await providerV2Api.updateAvailability(body));
    },
  );
  const now = useSubmit(async (body: { nowEnabled?: boolean; isAvailableNow?: boolean }) => {
    onProfile(await providerApi.availability(body));
  });

  return (
    <Card highlight={a.receivesNewJobs ? 'success' : undefined} testID="availability-card">
      <View style={styles.rowBetween}>
        <Heading>Müsaitlik</Heading>
        <Badge label={state.label} tone={state.tone} />
      </View>
      <Small>{state.body}</Small>

      <View style={styles.switchRow}>
        <View style={styles.flex}>
          <Text style={styles.switchLabel}>Yeni iş alıyorum</Text>
          <Small>Kapatırsan sana yeni talep gönderilmez.</Small>
        </View>
        <Switch
          testID="accepting-switch"
          value={a.acceptingNewJobs}
          disabled={settings.busy}
          onValueChange={(v) => void settings.submit({ acceptingNewJobs: v })}
          accessibilityLabel="Yeni iş alıyorum"
        />
      </View>

      {a.unavailableUntil ? (
        <>
          <Small>
            Bugün müsait değilsin ({formatDateTime(a.unavailableUntil)} tarihine kadar).
          </Small>
          <Button
            testID="available-today"
            title="Bugün yine müsaitim"
            variant="secondary"
            loading={settings.busy}
            onPress={() => void settings.submit({ availableToday: true })}
          />
        </>
      ) : (
        <Button
          testID="unavailable-today"
          title="Bugün müsait değilim"
          variant="secondary"
          loading={settings.busy}
          disabled={!a.acceptingNewJobs}
          onPress={() => void settings.submit({ availableToday: false })}
        />
      )}
      <FormError message={settings.error} />

      {profile ? (
        profile.nowEnabled ? (
          <View style={styles.switchRow}>
            <View style={styles.flex}>
              <Text style={styles.switchLabel}>
                {profile.isAvailableNow
                  ? '🟢 Acil işler: Müsaitim'
                  : '⚪ Acil işler: Müsait değilim'}
              </Text>
              <Small>
                {nowBlocked
                  ? 'Acil iş almak için hesabının doğrulanmış ve aktif olması gerekir.'
                  : 'Açıkken bölgendeki acil (NOW) işler sana gelir.'}
              </Small>
            </View>
            <Switch
              testID="availability-switch"
              value={profile.isAvailableNow}
              disabled={now.busy || (nowBlocked && !profile.isAvailableNow)}
              onValueChange={(v) => void now.submit({ isAvailableNow: v })}
              accessibilityLabel="Acil işler için müsaitim"
            />
          </View>
        ) : (
          <Button
            title="Acil Usta’yı aç"
            variant="ghost"
            loading={now.busy}
            disabled={nowBlocked}
            accessibilityHint={
              nowBlocked ? 'Acil iş için hesabın doğrulanmış ve aktif olmalı' : undefined
            }
            onPress={() => void now.submit({ nowEnabled: true })}
          />
        )
      ) : null}
      <FormError message={now.error} />

      <Button
        testID="open-availability-settings"
        title="Çalışma saatleri ve izinler"
        variant="ghost"
        onPress={() => router.push('/provider-settings/availability')}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  flex: { flex: 1, gap: 2 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: typography.minTouchTarget,
  },
  switchLabel: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
});
