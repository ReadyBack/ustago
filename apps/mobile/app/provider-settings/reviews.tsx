import type { PublicReview } from '@ustago/types';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { errorMessage } from '../../src/api/client';
import { providerV2Api } from '../../src/api/provider-v2';
import { useAuth } from '../../src/auth/AuthContext';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/States';
import { ReviewReplyCard } from '../../src/features/provider/ReviewReplyCard';
import { colors, spacing } from '../../src/lib/theme';

/** Değerlendirmelerim: the provider's published reviews with a one-time reply. */
export default function MyReviews() {
  const { user } = useAuth();
  const providerId = user?.providerProfile?.id ?? '';
  const [items, setItems] = useState<PublicReview[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (): Promise<void> =>
      providerV2Api.reviews(providerId).then(
        (page) => {
          setItems(page.items);
          setCursor(page.nextCursor);
          setError(null);
          setLoading(false);
        },
        (e: unknown) => {
          setError(errorMessage(e));
          setLoading(false);
        },
      ),
    [providerId],
  );

  useEffect(() => {
    if (providerId) void load();
  }, [load, providerId]);

  const more = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await providerV2Api.reviews(providerId, cursor);
      setItems((list) => [...list, ...page.items.filter((r) => !list.some((x) => x.id === r.id))]);
      setCursor(page.nextCursor);
    } catch {
      // Scrolling again retries.
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState
          message={error}
          onRetry={() => {
            setLoading(true);
            void load();
          }}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          onEndReached={() => void more()}
          onEndReachedThreshold={0.3}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} /> : null}
          ListEmptyComponent={
            <EmptyState
              icon="⭐"
              title="Henüz değerlendirme yok"
              body="Tamamlanan işlerin ardından müşterilerin yorumları burada görünür."
            />
          }
          renderItem={({ item }) => (
            <ReviewReplyCard
              review={item}
              onReplied={(reply) =>
                setItems((list) => list.map((r) => (r.id === item.id ? { ...r, reply } : r)))
              }
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  list: { padding: spacing.md, gap: spacing.md, flexGrow: 1 },
});
