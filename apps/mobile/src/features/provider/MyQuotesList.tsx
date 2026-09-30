import type { Paginated, ProviderQuoteListItem } from '@ustago/types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { type ProviderQuoteFilter, providerApi } from '../../api/services';
import { Badge } from '../../components/Badge';
import { Card } from '../../components/Card';
import { Chip } from '../../components/Chip';
import { Screen } from '../../components/Screen';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { Small } from '../../components/Text';
import { useApi } from '../../hooks/useApi';
import { categoryIcon } from '../../lib/categories';
import { formatBudget, formatMoney, timeAgo } from '../../lib/format';
import { quoteStatusLabel } from '../../lib/labels';
import { colors, spacing } from '../../lib/theme';

const FILTERS: { value: ProviderQuoteFilter | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'Tümü' },
  { value: 'NEGOTIATING', label: 'Sıra sizde' },
  { value: 'WAITING', label: 'Müşteri bekleniyor' },
  { value: 'ACCEPTED', label: 'Kabul edilen' },
  { value: 'CLOSED', label: 'Kapanan' },
];

/** "Tekliflerim" (the former Teklifler tab), now a segment of İşler. */
export function MyQuotesList() {
  const router = useRouter();
  const [filter, setFilter] = useState<ProviderQuoteFilter | 'ALL'>('ALL');
  const list = useApi<Paginated<ProviderQuoteListItem>>(
    `provider-quotes:${filter}`,
    () => providerApi.quotes(filter === 'ALL' ? undefined : filter),
    { pollMs: 15_000 },
  );

  return (
    <Screen onRefresh={list.refresh} refreshing={list.refreshing}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {FILTERS.map((f) => (
          <Chip
            key={f.value}
            label={f.label}
            selected={filter === f.value}
            onPress={() => setFilter(f.value)}
          />
        ))}
      </ScrollView>
      {list.loading ? (
        <LoadingState />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.refresh} />
      ) : list.data?.items.length === 0 ? (
        <EmptyState
          icon="💬"
          title="Teklif yok"
          body="Sana Uygun İşler bölümünden bir işe teklif verebilirsin."
        />
      ) : (
        list.data?.items.map((q) => {
          const label = quoteStatusLabel(q.status, 'PROVIDER');
          return (
            <Card
              key={q.id}
              testID={`my-quote-${q.id}`}
              onPress={() => router.push(`/quote/${q.id}`)}
              highlight={
                q.turn === 'PROVIDER' ? 'primary' : q.status === 'ACCEPTED' ? 'success' : undefined
              }
            >
              <View style={styles.row}>
                <Text style={styles.icon}>{categoryIcon(q.request.category.slug)}</Text>
                <View style={styles.flex}>
                  <Text style={styles.title} numberOfLines={1}>
                    {q.request.type === 'NOW' ? '🚨 ' : ''}
                    {q.request.title}
                  </Text>
                  <Small>
                    {q.request.location.district.name} · bütçe {formatBudget(q.request.budget)}
                  </Small>
                </View>
              </View>
              <View style={styles.rowBetween}>
                <Text style={styles.price}>{formatMoney(q.latest.total)}</Text>
                <Badge label={label.label} tone={label.tone} />
              </View>
              <Small>
                {q.revisionCount}. adım ·{' '}
                {q.latest.by === 'PROVIDER' ? 'son teklif sizden' : 'son teklif müşteriden'} ·{' '}
                {timeAgo(q.updatedAt)}
              </Small>
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { gap: spacing.sm, paddingVertical: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  flex: { flex: 1 },
  icon: { fontSize: 26 },
  title: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  price: { fontSize: 20, fontWeight: '800', color: colors.textPrimary },
});
