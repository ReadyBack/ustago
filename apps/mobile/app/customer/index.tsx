import type { JobListItem, Paginated, ServiceCategoryNode } from '@ustago/types';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { catalogApi, jobApi } from '../../src/api/services';
import { useAuth } from '../../src/auth/AuthContext';
import { ActiveJobCard } from '../../src/components/ActiveJobCard';
import { NotificationBell } from '../../src/components/NotificationBell';
import { PushPrompt } from '../../src/components/PushPrompt';
import { Screen } from '../../src/components/Screen';
import { ErrorState, LoadingState } from '../../src/components/States';
import { Body, Heading } from '../../src/components/Text';
import { useApi } from '../../src/hooks/useApi';
import { categoryIcon } from '../../src/lib/categories';
import { colors, radii, spacing } from '../../src/lib/theme';

export default function CustomerHome() {
  const router = useRouter();
  const { user } = useAuth();
  const categories = useApi<ServiceCategoryNode[]>('categories', catalogApi.categories);
  const active = useApi<Paginated<JobListItem>>(
    'jobs:customer:active',
    () => jobApi.list('CUSTOMER', 'ACTIVE'),
    { pollMs: 15_000 },
  );
  const refresh = () => void Promise.all([categories.refresh(), active.refresh()]);

  return (
    <Screen edges={['top']} onRefresh={refresh} refreshing={categories.refreshing}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text style={styles.hello}>Merhaba {user?.firstName} 👋</Text>
          <Body muted>Bugün ne yaptırmak istersiniz?</Body>
        </View>
        <NotificationBell />
      </View>

      {(active.data?.items ?? []).map((job) => (
        <ActiveJobCard key={job.id} job={job} viewer="CUSTOMER" />
      ))}
      <PushPrompt viewer="CUSTOMER" />

      <Pressable
        testID="emergency-button"
        accessibilityRole="button"
        accessibilityLabel="Acil usta çağır"
        accessibilityHint="Hemen gelebilecek müsait ustalara acil talep gönderir"
        onPress={() => router.push({ pathname: '/request/new', params: { type: 'NOW' } })}
        style={({ pressed }) => [styles.emergency, pressed && { opacity: 0.9 }]}
      >
        <Text style={styles.emergencyTitle}>🚨 ACİL USTA</Text>
        <Text style={styles.emergencyBody}>Şu an müsait ustalara ulaşın, hızlı fiyat alın.</Text>
      </Pressable>

      <Heading>Hizmetler</Heading>
      {categories.loading ? (
        <LoadingState />
      ) : categories.error ? (
        <ErrorState message={categories.error} onRetry={categories.refresh} />
      ) : (
        <View style={styles.grid}>
          {(categories.data ?? []).map((c) => (
            <Pressable
              key={c.id}
              accessibilityRole="button"
              accessibilityLabel={`${c.name} için teklif al`}
              onPress={() =>
                router.push({
                  pathname: '/request/new',
                  params: { type: 'QUOTE', categoryId: c.id },
                })
              }
              style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.tileIcon}>{categoryIcon(c.slug)}</Text>
              <Text style={styles.tileText} numberOfLines={2}>
                {c.name}
              </Text>
              {c.supportsNow ? <Text style={styles.nowTag}>Acil</Text> : null}
            </Pressable>
          ))}
        </View>
      )}
      <View style={styles.info}>
        <Text style={styles.infoTitle}>Nasıl çalışır?</Text>
        <Body muted>
          1. Talebinizi yazın, isterseniz tahmini bütçenizi ekleyin.{'\n'}2. Ustalar size teklif
          versin; fiyat üzerinde karşılıklı pazarlık yapın.{'\n'}3. Uygun teklifi kabul edin, fiyat
          kilitlenir ve iş oluşur.
        </Body>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  flex: { flex: 1 },
  hello: { fontSize: 24, fontWeight: '800', color: colors.textPrimary, marginTop: spacing.sm },
  emergency: {
    backgroundColor: colors.emergency,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.xs,
    minHeight: 96,
    justifyContent: 'center',
  },
  emergencyTitle: { color: colors.textInverse, fontSize: 24, fontWeight: '900' },
  emergencyBody: { color: colors.textInverse, fontSize: 15, opacity: 0.95 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'flex-start' },
  tile: {
    width: '31.5%',
    minHeight: 96,
    backgroundColor: colors.background,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
    gap: 4,
  },
  tileIcon: { fontSize: 28 },
  tileText: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, textAlign: 'center' },
  nowTag: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.emergency,
    backgroundColor: colors.emergencySoft,
    paddingHorizontal: 6,
    borderRadius: 6,
    overflow: 'hidden',
  },
  info: {
    backgroundColor: colors.primarySoft,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  infoTitle: { fontWeight: '700', color: colors.primaryDark },
});
