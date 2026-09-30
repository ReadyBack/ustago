import type {
  CategoryRef,
  CustomerHome as CustomerHomeData,
  ProviderCard as ProviderCardData,
  ServiceCategoryNode,
} from '@ustago/types';
import { useRouter } from 'expo-router';
import { type ReactNode, useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { homeApi } from '../../src/api/customer-v2';
import { catalogApi } from '../../src/api/services';
import { useAuth } from '../../src/auth/AuthContext';
import { Badge } from '../../src/components/Badge';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Chip } from '../../src/components/Chip';
import { PushPrompt } from '../../src/components/PushPrompt';
import { Screen } from '../../src/components/Screen';
import { ErrorState, LoadingState } from '../../src/components/States';
import { Body, Heading, Small } from '../../src/components/Text';
import { ProviderAvatar } from '../../src/features/customer/ProviderAvatar';
import { ProviderCard } from '../../src/features/customer/ProviderCard';
import { WAITLIST_TEXT } from '../../src/features/customer/text';
import { useApi } from '../../src/hooks/useApi';
import { categoryIcon } from '../../src/lib/categories';
import { formatDate, formatMoney } from '../../src/lib/format';
import { JOB_STATUS } from '../../src/lib/labels';
import { colors, radii, spacing, typography } from '../../src/lib/theme';

/** Customer home V2: every section is real data and hides when empty. */
export default function CustomerHome() {
  const router = useRouter();
  const { user } = useAuth();
  const home = useApi<CustomerHomeData>('customer:home', homeApi.get, { pollMs: 60_000 });
  const categories = useApi<ServiceCategoryNode[]>('categories', catalogApi.categories);
  const refresh = () => void Promise.all([home.refresh(), categories.refresh()]);

  const openCategory = useCallback(
    (c: { id: string; name: string }) =>
      router.push({ pathname: '/providers', params: { categoryId: c.id, categoryName: c.name } }),
    [router],
  );
  const openProvider = useCallback((p: ProviderCardData) => router.push(`/usta/${p.id}`), [router]);

  const h = home.data;
  const isNew =
    h !== null &&
    h.activeJobs.length === 0 &&
    h.requestsWithQuotes.length === 0 &&
    h.favorites.length === 0 &&
    h.rehire.length === 0 &&
    h.recentCategories.length === 0;

  return (
    <Screen edges={['top']} onRefresh={refresh} refreshing={home.refreshing}>
      <View style={styles.header}>
        <Text style={styles.hello} accessibilityRole="header">
          Merhaba {user?.firstName} 👋
        </Text>
        {h?.area ? (
          <Small>
            📍 {h.area.district.name} / {h.area.province.name} (varsayılan adresin)
          </Small>
        ) : null}
      </View>

      <Pressable
        testID="home-search"
        accessibilityRole="search"
        accessibilityLabel="Hizmet ara"
        accessibilityHint="Örneğin elektrik, tesisat, boya"
        onPress={() => router.push('/search')}
        style={({ pressed }) => [styles.search, pressed && styles.pressed]}
      >
        <Text style={styles.searchText}>🔍 Ne yaptırmak istiyorsun? (ör. elektrik, boya)</Text>
      </Pressable>

      {h?.launchStatus === 'WAITLIST' ? (
        <View style={styles.waitlist} accessibilityRole="alert" testID="waitlist-banner">
          <Text style={styles.waitlistText}>⏳ {WAITLIST_TEXT}</Text>
        </View>
      ) : h?.launchStatus === 'DISABLED' ? (
        <View style={styles.waitlist} accessibilityRole="alert">
          <Text style={styles.waitlistText}>UstaGO bu ilde henüz hizmet vermiyor.</Text>
        </View>
      ) : null}

      {home.error && !h ? (
        <Card>
          <Body muted>Ana sayfa bilgileri yüklenemedi: {home.error}</Body>
          <Button title="Tekrar dene" variant="secondary" onPress={() => void home.refresh()} />
        </Card>
      ) : null}

      {h && h.activeJobs.length > 0 ? (
        <Section title="Devam eden işlerin">
          {h.activeJobs.map((j) => {
            const status = JOB_STATUS[j.status];
            return (
              <Card
                key={j.jobId}
                highlight="success"
                onPress={() => router.push(`/job/${j.jobId}`)}
                accessibilityLabel={`${j.category.name}, ${j.providerName}, ${status.label}`}
              >
                <View style={styles.between}>
                  <Badge label={status.label} tone={status.tone} />
                  <Text style={styles.money}>{formatMoney(j.total)}</Text>
                </View>
                <Text style={styles.cardTitle}>
                  {categoryIcon(j.category.slug)} {j.category.name}
                </Text>
                <Small>Usta: {j.providerName}</Small>
              </Card>
            );
          })}
        </Section>
      ) : null}

      {h && h.requestsWithQuotes.length > 0 ? (
        <Section title="Teklif gelen taleplerin">
          {h.requestsWithQuotes.map((r) => (
            <Card
              key={r.requestId}
              highlight="primary"
              onPress={() => router.push(`/request/${r.requestId}`)}
              accessibilityLabel={`${r.title}, ${r.openQuoteCount} açık teklif`}
            >
              <Text style={styles.cardTitle}>{r.title}</Text>
              <Small>
                {categoryIcon(r.category.slug)} {r.category.name} · {r.openQuoteCount} açık teklif
              </Small>
            </Card>
          ))}
        </Section>
      ) : null}

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
        <Text style={styles.emergencyBody}>Şu an müsait ustalara ulaş, hızlı fiyat al.</Text>
      </Pressable>

      {isNew ? (
        <Card style={styles.welcome}>
          <Heading>UstaGO’ya hoş geldin</Heading>
          <Body muted>
            Aradığın hizmeti yaz ya da aşağıdan seç. Talebini oluştur, bölgendeki ustalar sana
            teklif versin; fiyatı karşılaştırıp anlaştığın ustayla işini yaptır.
          </Body>
        </Card>
      ) : null}

      {h && h.rehire.length > 0 ? (
        <Section title="Tekrar çağır">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.hList}
          >
            {h.rehire.map((r) => (
              <View key={r.jobId} style={styles.rehire} testID={`rehire-${r.jobId}`}>
                <View style={styles.row}>
                  <ProviderAvatar
                    name={r.provider.displayName}
                    photoUrl={r.provider.photoUrl}
                    size={40}
                  />
                  <View style={styles.flex}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {r.provider.displayName}
                    </Text>
                    <Small>
                      {r.category.name} · {formatDate(r.completedAt)}
                    </Small>
                  </View>
                </View>
                <Button
                  title="Tekrar çağır"
                  variant="secondary"
                  accessibilityLabel={`${r.provider.displayName} ustasını ${r.category.name} için tekrar çağır`}
                  onPress={() =>
                    router.push({ pathname: '/request/new', params: { rehireJobId: r.jobId } })
                  }
                />
              </View>
            ))}
          </ScrollView>
        </Section>
      ) : null}

      {h && h.favorites.length > 0 ? (
        <Section
          title="Favori ustaların"
          action={{ title: 'Tümü', onPress: () => router.push('/favorites') }}
        >
          {h.favorites.slice(0, 3).map((p) => (
            <ProviderCard key={p.id} provider={p} onPress={openProvider} />
          ))}
        </Section>
      ) : null}

      {h && h.recentCategories.length > 0 ? (
        <Section title="Son baktıkların">
          <CategoryChips items={h.recentCategories} onPress={openCategory} />
        </Section>
      ) : null}

      {h && h.popularCategories.length > 0 ? (
        <Section title="Bölgende sık istenenler">
          <CategoryChips items={h.popularCategories} onPress={openCategory} />
        </Section>
      ) : null}

      {h && h.nearbyProviders.length > 0 ? (
        <Section title="Yakınındaki ustalar">
          {h.nearbyProviders.map((p) => (
            <ProviderCard key={p.id} provider={p} onPress={openProvider} />
          ))}
        </Section>
      ) : null}

      <Heading>Tüm hizmetler</Heading>
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
              accessibilityLabel={`${c.name} ustalarını gör`}
              onPress={() => openCategory(c)}
              style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
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
      {home.loading ? <LoadingState label="Senin için hazırlanıyor…" /> : null}
    </Screen>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: { title: string; onPress: () => void };
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.between}>
        <Heading>{title}</Heading>
        {action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${title}: ${action.title}`}
            onPress={action.onPress}
            style={styles.link}
          >
            <Text style={styles.linkText}>{action.title}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function CategoryChips({
  items,
  onPress,
}: {
  items: CategoryRef[];
  onPress: (c: CategoryRef) => void;
}) {
  return (
    <View style={styles.chips}>
      {items.map((c) => (
        <Chip
          key={c.id}
          label={`${categoryIcon(c.slug)} ${c.name}`}
          selected={false}
          onPress={() => onPress(c)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: 2, marginTop: spacing.sm },
  hello: { fontSize: 24, fontWeight: '800', color: colors.textPrimary },
  search: {
    minHeight: 52,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  searchText: { fontSize: 15, color: colors.textSecondary },
  pressed: { opacity: 0.8 },
  waitlist: {
    backgroundColor: colors.warningSoft,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  waitlistText: { color: '#9A6200', fontSize: 14, fontWeight: '600' },
  section: { gap: spacing.sm },
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  link: {
    minHeight: typography.minTouchTarget,
    minWidth: typography.minTouchTarget,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  linkText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  money: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  hList: { gap: spacing.sm },
  rehire: {
    width: 260,
    backgroundColor: colors.background,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  welcome: { backgroundColor: colors.primarySoft, borderColor: colors.primarySoft },
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
});
