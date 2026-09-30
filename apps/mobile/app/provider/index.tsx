import type {
  JobListItem,
  Paginated,
  ProfileCompletenessKey,
  ProviderHome,
  ProviderProfile,
  ProviderVerificationCaseView,
  ProviderVerificationStatus,
  Wallet,
} from '@ustago/types';
import { formatMoney } from '@ustago/validation';
import { type Href, useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { walletApi } from '../../src/api/finance';
import { providerV2Api } from '../../src/api/provider-v2';
import { jobApi, providerApi } from '../../src/api/services';
import { useAuth } from '../../src/auth/AuthContext';
import { AccountStatusCard } from '../../src/components/AccountStatusCard';
import { ActiveJobCard } from '../../src/components/ActiveJobCard';
import { Badge } from '../../src/components/Badge';
import { Card } from '../../src/components/Card';
import { ProviderGate } from '../../src/components/ProviderGate';
import { PushPrompt } from '../../src/components/PushPrompt';
import { Screen } from '../../src/components/Screen';
import { ErrorState, LoadingState } from '../../src/components/States';
import { Heading, Small } from '../../src/components/Text';
import { AvailabilityCard } from '../../src/features/provider/AvailabilityCard';
import { useApi } from '../../src/hooks/useApi';
import { colors, radii, spacing, typography } from '../../src/lib/theme';
import { VERIFICATION_STATUS } from '../../src/lib/verification';

export default function ProviderHomeTab() {
  const { refreshUser } = useAuth();
  // The provider's status can change while the app is open (admin approval).
  useFocusEffect(
    useCallback(() => {
      void refreshUser();
    }, [refreshUser]),
  );
  return (
    <ProviderGate>
      <Home />
    </ProviderGate>
  );
}

/** Where each profile checklist item is completed. */
const COMPLETENESS_ROUTE: Record<ProfileCompletenessKey, Href> = {
  photo: '/provider-settings/photo',
  bio: '/provider-onboarding',
  services: '/provider-onboarding',
  areas: '/provider-settings/coverage',
  portfolio: '/provider-settings/portfolio',
  availability: '/provider-settings/availability',
  verification: '/verification',
};

function Home() {
  const router = useRouter();
  const home = useApi<ProviderHome>('provider:home', providerV2Api.home, { pollMs: 30_000 });
  const profile = useApi<ProviderProfile>('provider:me', providerApi.me);
  // Account status can change while the app is open (suspension, review decision).
  const account = useApi<ProviderVerificationCaseView>(
    'provider:verification',
    providerApi.verificationCase,
    { pollMs: 60_000 },
  );
  const active = useApi<Paginated<JobListItem>>(
    'jobs:provider:active',
    () => jobApi.list('PROVIDER', 'ACTIVE'),
    { pollMs: 15_000 },
  );
  // Only to know whether the amounts are TEST money.
  const wallet = useApi<Wallet>('wallet', walletApi.get);

  const refreshAll = () =>
    void Promise.all([
      home.refresh(),
      profile.refresh(),
      account.refresh(),
      active.refresh(),
      wallet.refresh(),
    ]);

  if (home.loading) return <LoadingState />;
  if (home.error || !home.data) {
    return <ErrorState message={home.error ?? 'Ana sayfa yüklenemedi.'} onRetry={home.refresh} />;
  }
  const h = home.data;
  const acc = account.data;
  const nowBlocked = acc ? !acc.capabilities.canTakeNowJobs : false;
  const test = wallet.data?.testMode ?? false;
  const verification =
    VERIFICATION_STATUS[h.verificationStatus as ProviderVerificationStatus] ?? null;

  const counters: { key: string; label: string; value: string; to: Href; testMode?: boolean }[] = [
    {
      key: 'new',
      label: 'Yeni uygun işler',
      value: String(h.newMatchingJobs),
      to: '/provider/jobs?segment=inbox&dispatched=1',
    },
    {
      key: 'open',
      label: 'Açık fırsatlar',
      value: String(h.openOpportunities),
      to: '/provider/jobs?segment=inbox',
    },
    {
      key: 'active',
      label: 'Aktif işler',
      value: String(h.activeJobs),
      to: '/provider/jobs?segment=active',
    },
    {
      key: 'quotes',
      label: 'Bekleyen teklifler',
      value: String(h.pendingQuotes),
      to: '/provider/jobs?segment=quotes',
    },
    {
      key: 'messages',
      label: 'Okunmamış mesajlar',
      value: String(h.unreadMessages),
      to: '/provider/messages',
    },
    {
      key: 'today',
      label: 'Bugünkü kazanç',
      value: formatMoney(h.todayEarningsMinor),
      to: '/provider/earnings',
      testMode: test,
    },
    {
      key: 'balance',
      label: 'Çekilebilir bakiye',
      value: formatMoney(h.availableBalanceMinor),
      to: '/payouts',
      testMode: test,
    },
  ];

  return (
    <Screen onRefresh={refreshAll} refreshing={home.refreshing}>
      {acc ? <AccountStatusCard view={acc} /> : null}
      {(active.data?.items ?? []).map((job) => (
        <ActiveJobCard key={job.id} job={job} viewer="PROVIDER" />
      ))}
      <PushPrompt viewer="PROVIDER" />

      <AvailabilityCard
        availability={h.availability}
        profile={profile.data}
        nowBlocked={nowBlocked}
        onAvailability={(availability) => home.setData({ ...h, availability })}
        onProfile={(p) => profile.setData(p)}
      />

      <View style={styles.grid}>
        {counters.map((c) => (
          <Pressable
            key={c.key}
            testID={`counter-${c.key}`}
            accessibilityRole="button"
            accessibilityLabel={`${c.label}: ${c.value}${c.testMode ? ', test parası' : ''}`}
            onPress={() => router.push(c.to)}
            style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
          >
            <Text style={styles.tileValue}>{c.value}</Text>
            <Text style={styles.tileLabel}>{c.label}</Text>
            {c.testMode ? <Badge label="TEST" tone="warning" /> : null}
          </Pressable>
        ))}
      </View>

      <Card testID="profile-completeness">
        <View style={styles.rowBetween}>
          <Heading>Profilin</Heading>
          <Text style={styles.percent}>%{h.profileCompleteness.percent}</Text>
        </View>
        <View
          style={styles.progress}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: h.profileCompleteness.percent }}
        >
          <View style={[styles.progressFill, { width: `${h.profileCompleteness.percent}%` }]} />
        </View>
        <Small>Eksik bilgileri tamamlaman, müşterilerin seni tanımasını kolaylaştırır.</Small>
        {h.profileCompleteness.items.map((item) => (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            accessibilityLabel={`${item.label}: ${item.done ? 'tamam' : 'eksik'}`}
            onPress={() => router.push(COMPLETENESS_ROUTE[item.key])}
            style={styles.checkRow}
          >
            <Text style={[styles.check, item.done && styles.checkDone]}>
              {item.done ? '✓' : '○'}
            </Text>
            <Text style={[styles.checkLabel, item.done && styles.checkLabelDone]}>
              {item.label}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </Card>

      <Card onPress={() => router.push('/verification')} accessibilityLabel="Hesap doğrulama">
        <View style={styles.rowBetween}>
          <Heading>Hesap doğrulama</Heading>
          <Badge
            label={verification?.label ?? h.verificationStatus}
            tone={verification?.tone ?? 'neutral'}
          />
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 84,
    backgroundColor: colors.background,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 4,
  },
  pressed: { opacity: 0.8 },
  tileValue: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  tileLabel: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  percent: { fontSize: 18, fontWeight: '800', color: colors.primary },
  progress: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  progressFill: { height: 8, backgroundColor: colors.primary },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: typography.minTouchTarget,
  },
  check: { fontSize: 18, width: 24, color: colors.textSecondary },
  checkDone: { color: colors.success },
  checkLabel: { flex: 1, fontSize: 15, color: colors.textPrimary },
  checkLabelDone: { color: colors.textSecondary },
  chevron: { fontSize: 20, color: colors.textSecondary },
});
