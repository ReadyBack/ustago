import type { FavoriteProvider, Paginated, ProviderCard as ProviderCardData } from '@ustago/types';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { favoritesApi } from '../src/api/customer-v2';
import { Button } from '../src/components/Button';
import { EmptyState, ErrorState, FormError, LoadingState } from '../src/components/States';
import { Small } from '../src/components/Text';
import { ProviderAvatar } from '../src/features/customer/ProviderAvatar';
import { ProviderCard } from '../src/features/customer/ProviderCard';
import { UNAVAILABLE_TEXT } from '../src/features/customer/text';
import { useApi } from '../src/hooks/useApi';
import { useSubmit } from '../src/hooks/useSubmit';
import { colors, radii, spacing } from '../src/lib/theme';

/** "Favori Ustalarım". Suspended or unlisted providers stay listed, clearly marked, until removed. */
export default function Favorites() {
  const router = useRouter();
  const first = useApi<Paginated<FavoriteProvider>>('favorites', () => favoritesApi.list());
  const [older, setOlder] = useState<FavoriteProvider[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const next = cursor === undefined ? (first.data?.nextCursor ?? null) : cursor;

  const more = useSubmit(async () => {
    if (!next) return;
    const page = await favoritesApi.list(next);
    setOlder((o) => [...o, ...page.items]);
    setCursor(page.nextCursor);
  });
  const remove = useSubmit(async (providerId: string) => {
    await favoritesApi.remove(providerId);
    setRemoved((s) => new Set(s).add(providerId));
  });

  const onFavoriteChange = useCallback((providerId: string, isFavorite: boolean) => {
    setRemoved((s) => {
      const copy = new Set(s);
      if (isFavorite) copy.delete(providerId);
      else copy.add(providerId);
      return copy;
    });
  }, []);
  const openProvider = useCallback((p: ProviderCardData) => router.push(`/usta/${p.id}`), [router]);

  const base = first.data?.items ?? [];
  const items = [
    ...base,
    ...older.filter((o) => !base.some((b) => b.provider.id === o.provider.id)),
  ].filter((f) => !removed.has(f.provider.id) || f.available);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <FlatList
        data={first.loading || first.error ? [] : items}
        keyExtractor={(f) => f.provider.id}
        contentContainerStyle={styles.content}
        refreshing={first.refreshing}
        onRefresh={() => {
          setOlder([]);
          setCursor(undefined);
          setRemoved(new Set());
          void first.refresh();
        }}
        renderItem={({ item: f }) =>
          f.available ? (
            <ProviderCard
              provider={f.provider}
              onPress={openProvider}
              onFavoriteChange={onFavoriteChange}
            />
          ) : (
            <View style={styles.unavailable} testID={`favorite-unavailable-${f.provider.id}`}>
              <View style={styles.row}>
                <ProviderAvatar name={f.provider.displayName} photoUrl={null} size={44} />
                <View style={styles.flex}>
                  <Text style={styles.name}>{f.provider.displayName}</Text>
                  <Small>{UNAVAILABLE_TEXT}</Small>
                </View>
              </View>
              <Button
                title="Favorilerden çıkar"
                variant="ghost"
                accessibilityLabel={`${f.provider.displayName} favorilerden çıkar`}
                loading={remove.busy}
                onPress={() => void remove.submit(f.provider.id)}
              />
            </View>
          )
        }
        ListHeaderComponent={<FormError message={remove.error} />}
        ListEmptyComponent={
          first.loading ? (
            <LoadingState />
          ) : first.error ? (
            <ErrorState message={first.error} onRetry={first.refresh} />
          ) : (
            <EmptyState
              icon="♡"
              title="Henüz favori ustan yok"
              body="Beğendiğin ustaları profilindeki kalp ile favorilerine ekle; tekrar çağırmak kolaylaşsın."
              action={{ title: 'Usta ara', onPress: () => router.push('/search') }}
            />
          )
        }
        ListFooterComponent={
          next ? (
            <View style={styles.footer}>
              <Button
                title="Daha fazla"
                variant="secondary"
                loading={more.busy}
                onPress={() => void more.submit()}
              />
              <FormError message={more.error} />
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  unavailable: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
    opacity: 0.85,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  name: { fontSize: 16, fontWeight: '700', color: colors.textSecondary },
  footer: { gap: spacing.sm, marginTop: spacing.sm },
});
