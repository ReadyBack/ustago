import type { Opportunity, ProviderServiceItem } from '@ustago/types';
import { TRAVEL_DISTANCE_PRESETS_KM } from '@ustago/validation';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '../../api/client';
import { type OpportunitySort, providerV2Api } from '../../api/provider-v2';
import { providerApi } from '../../api/services';
import { Chip } from '../../components/Chip';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { Small } from '../../components/Text';
import { useApi } from '../../hooks/useApi';
import { colors, spacing } from '../../lib/theme';
import { OpportunityCard } from './OpportunityCard';

const SORTS: { value: OpportunitySort; label: string }[] = [
  { value: 'NEW', label: 'Yeni' },
  { value: 'NEAREST', label: 'En yakın' },
  { value: 'BUDGET', label: 'Bütçe' },
];

/** Refresh while on screen; push is only a best-effort nudge. */
const INBOX_POLL_MS = 30_000;

export interface InboxFilters {
  sort: OpportunitySort;
  maxDistanceKm: number | null;
  categoryId: string | null;
  dispatchedOnly: boolean;
}

/** "Sana Uygun İşler": open requests the provider may quote on. */
export function OpportunityInbox({
  initialDispatchedOnly = false,
}: {
  initialDispatchedOnly?: boolean;
}) {
  const router = useRouter();
  const [filters, setFilters] = useState<InboxFilters>({
    sort: 'NEW',
    maxDistanceKm: null,
    categoryId: null,
    dispatchedOnly: initialDispatchedOnly,
  });
  const [items, setItems] = useState<Opportunity[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const services = useApi<ProviderServiceItem[]>('provider:services', providerApi.services);

  const loadFirst = useCallback(
    async (quiet: boolean) => {
      const id = ++seq.current;
      try {
        const page = await providerV2Api.opportunities(filters);
        if (id !== seq.current) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setError(null);
      } catch (e) {
        if (id === seq.current && !quiet) setError(errorMessage(e));
      } finally {
        if (id === seq.current) setLoading(false);
      }
    },
    [filters],
  );

  useFocusEffect(
    useCallback(() => {
      void loadFirst(false);
      const timer = setInterval(() => void loadFirst(true), INBOX_POLL_MS);
      return () => clearInterval(timer);
    }, [loadFirst]),
  );

  const change = (patch: Partial<InboxFilters>) => {
    setLoading(true);
    setFilters((f) => ({ ...f, ...patch }));
  };

  const refresh = async () => {
    setRefreshing(true);
    await loadFirst(false);
    setRefreshing(false);
  };

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const id = seq.current;
    try {
      const page = await providerV2Api.opportunities({ ...filters, cursor });
      if (id !== seq.current) return;
      setItems((list) => {
        const seen = new Set(list.map((o) => o.id));
        return [...list, ...page.items.filter((o) => !seen.has(o.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      // Scrolling again retries.
    } finally {
      setLoadingMore(false);
    }
  };

  const header = (
    <View style={styles.filters}>
      <Text style={styles.filterLabel}>Sırala</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {SORTS.map((s) => (
          <Chip
            key={s.value}
            label={s.label}
            selected={filters.sort === s.value}
            onPress={() => change({ sort: s.value })}
          />
        ))}
        <Chip
          label="Bana gönderilenler"
          selected={filters.dispatchedOnly}
          onPress={() => change({ dispatchedOnly: !filters.dispatchedOnly })}
        />
      </ScrollView>
      <Text style={styles.filterLabel}>En fazla uzaklık</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        <Chip
          label="Hepsi"
          selected={filters.maxDistanceKm === null}
          onPress={() => change({ maxDistanceKm: null })}
        />
        {TRAVEL_DISTANCE_PRESETS_KM.map((km) => (
          <Chip
            key={km}
            label={`${km} km`}
            selected={filters.maxDistanceKm === km}
            onPress={() => change({ maxDistanceKm: km })}
          />
        ))}
      </ScrollView>
      {(services.data ?? []).length > 1 ? (
        <>
          <Text style={styles.filterLabel}>Kategori</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            <Chip
              label="Tümü"
              selected={filters.categoryId === null}
              onPress={() => change({ categoryId: null })}
            />
            {(services.data ?? []).map((s) => (
              <Chip
                key={s.categoryId}
                label={s.name}
                selected={filters.categoryId === s.categoryId}
                onPress={() => change({ categoryId: s.categoryId })}
              />
            ))}
          </ScrollView>
        </>
      ) : null}
      <Small>
        Uzaklıklar hizmet merkezin ile talebin ilçe merkezi arasındaki kuş uçuşu yaklaşık mesafedir.
        Açık adres, teklifin kabul edilince görünür.
      </Small>
    </View>
  );

  return (
    <FlatList
      testID="opportunity-inbox"
      data={loading || error ? [] : items}
      keyExtractor={(o) => o.id}
      contentContainerStyle={styles.list}
      ListHeaderComponent={header}
      refreshing={refreshing}
      onRefresh={() => void refresh()}
      onEndReached={() => void loadMore()}
      onEndReachedThreshold={0.3}
      ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} /> : null}
      ListEmptyComponent={
        loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void refresh()} />
        ) : (
          <EmptyState
            icon="🔎"
            title="Şu an uygun iş yok"
            body={
              filters.dispatchedOnly || filters.maxDistanceKm || filters.categoryId
                ? 'Bu filtrelere uyan açık talep yok. Filtreleri genişletmeyi deneyebilirsin.'
                : 'Hizmet verdiğin kategori ve bölgelerde yeni talep geldiğinde burada görünür.'
            }
          />
        )
      }
      renderItem={({ item }) => (
        <OpportunityCard o={item} onPress={() => router.push(`/opportunity/${item.id}`)} />
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.md, gap: spacing.md, flexGrow: 1 },
  filters: { gap: spacing.xs, marginBottom: spacing.sm },
  filterLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginTop: 4 },
  chips: { gap: spacing.sm, paddingVertical: 2 },
});
