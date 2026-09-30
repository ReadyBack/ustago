import type { Opportunity, Paginated, ProviderProfile } from '@ustago/types';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { providerApi } from '../../src/api/services';
import { useAuth } from '../../src/auth/AuthContext';
import { Badge } from '../../src/components/Badge';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { ProviderGate } from '../../src/components/ProviderGate';
import { Screen } from '../../src/components/Screen';
import { EmptyState, ErrorState, FormError, LoadingState } from '../../src/components/States';
import { Body, Heading, Small } from '../../src/components/Text';
import { useApi } from '../../src/hooks/useApi';
import { useSubmit } from '../../src/hooks/useSubmit';
import { categoryIcon } from '../../src/lib/categories';
import { formatBudget, timeAgo } from '../../src/lib/format';
import { colors, spacing } from '../../src/lib/theme';

export default function ProviderJobsFeed() {
  const { refreshUser } = useAuth();
  // The provider's status can change while the app is open (admin approval).
  useFocusEffect(
    useCallback(() => {
      void refreshUser();
    }, [refreshUser]),
  );
  return (
    <ProviderGate>
      <Feed />
    </ProviderGate>
  );
}

function Feed() {
  const router = useRouter();
  const profile = useApi<ProviderProfile>('provider:me', providerApi.me);
  const feed = useApi<Paginated<Opportunity>>('opportunities', () => providerApi.opportunities(), {
    pollMs: 10_000,
  });

  const toggle = useSubmit(async (body: { nowEnabled?: boolean; isAvailableNow?: boolean }) => {
    profile.setData(await providerApi.availability(body));
    await feed.refresh();
  });

  const items = [...(feed.data?.items ?? [])].sort((a, b) =>
    a.type === b.type ? 0 : a.type === 'NOW' ? -1 : 1,
  );
  const p = profile.data;

  return (
    <Screen
      onRefresh={() => void Promise.all([profile.refresh(), feed.refresh()])}
      refreshing={feed.refreshing}
    >
      {p ? (
        <Card highlight={p.isAvailableNow ? 'success' : undefined}>
          {p.nowEnabled ? (
            <View style={styles.row}>
              <View style={styles.flex}>
                <Text style={styles.availTitle}>
                  {p.isAvailableNow ? '🟢 Müsaitim' : '⚪ Şu an müsait değilim'}
                </Text>
                <Small>
                  {p.isAvailableNow
                    ? 'Bölgenizdeki acil işler bu listede en üstte görünür.'
                    : 'Açtığınızda acil (NOW) işleri de görürsünüz.'}
                </Small>
              </View>
              <Switch
                testID="availability-switch"
                value={p.isAvailableNow}
                disabled={toggle.busy}
                onValueChange={(v) => void toggle.submit({ isAvailableNow: v })}
                accessibilityLabel="Müsaitim"
              />
            </View>
          ) : (
            <>
              <Heading>Acil işler kapalı</Heading>
              <Body muted>
                Acil Usta’yı açarsanız, müsait olduğunuzda bölgenizdeki acil işler size gelir.
              </Body>
              <Button
                title="Acil Usta’yı aç"
                variant="secondary"
                loading={toggle.busy}
                onPress={() => void toggle.submit({ nowEnabled: true })}
              />
            </>
          )}
          <FormError message={toggle.error} />
        </Card>
      ) : null}

      <Heading>Size uygun işler</Heading>
      {feed.loading ? (
        <LoadingState />
      ) : feed.error ? (
        <ErrorState message={feed.error} onRetry={feed.refresh} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="🔎"
          title="Şu an uygun iş yok"
          body="Hizmet verdiğiniz kategori ve ilçelerde yeni talep geldiğinde burada görünür. Liste kendiliğinden yenilenir."
        />
      ) : (
        items.map((o) => (
          <Card
            key={o.id}
            testID={`opportunity-${o.id}`}
            onPress={() => router.push(`/opportunity/${o.id}`)}
            highlight={o.type === 'NOW' ? 'emergency' : undefined}
            accessibilityLabel={`${o.type === 'NOW' ? 'Acil iş, ' : ''}${o.title}, ${o.location.district.name}`}
          >
            {o.type === 'NOW' ? <Badge label="🚨 ACİL İŞ" tone="danger" /> : null}
            <View style={styles.row}>
              <Text style={styles.icon}>{categoryIcon(o.category.slug)}</Text>
              <View style={styles.flex}>
                <Text style={styles.title} numberOfLines={1}>
                  {o.title}
                </Text>
                <Small>
                  {o.category.name} · {o.location.district.name} / {o.location.province.name}
                </Small>
              </View>
            </View>
            <Body muted>
              {o.description.length > 120 ? `${o.description.slice(0, 117)}…` : o.description}
            </Body>
            <View style={styles.rowBetween}>
              <Text style={styles.budget}>Müşteri bütçesi: {formatBudget(o.budget)}</Text>
              <Small>{o.publishedAt ? timeAgo(o.publishedAt) : ''}</Small>
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  flex: { flex: 1 },
  availTitle: { fontSize: 17, fontWeight: '800', color: colors.textPrimary },
  icon: { fontSize: 26 },
  title: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  budget: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
});
