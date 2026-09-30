import type { ConversationListItem } from '@ustago/types';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { chatApi } from '../../api/chat';
import { errorMessage } from '../../api/client';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { Small } from '../../components/Text';
import { categoryIcon } from '../../lib/categories';
import { timeAgo } from '../../lib/format';
import { colors, radii, spacing } from '../../lib/theme';
import { lastMessagePreview } from './labels';

/** The list refreshes while it is on screen; there is no live connection. */
const LIST_POLL_MS = 30_000;

/** "Mesajlar" for both roles: one row per request/job conversation. */
export function ConversationList({ role }: { role: 'CUSTOMER' | 'PROVIDER' }) {
  const router = useRouter();
  const [items, setItems] = useState<ConversationListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const loadFirst = useCallback(async (quiet: boolean) => {
    const id = ++seq.current;
    try {
      const page = await chatApi.list();
      if (id !== seq.current) return;
      setItems(page.items);
      setCursor(page.nextCursor);
      setError(null);
    } catch (e) {
      if (id === seq.current && !quiet) setError(errorMessage(e));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  // Reload whenever the tab comes back into view, then every 30 s while it stays.
  useFocusEffect(
    useCallback(() => {
      void loadFirst(true);
      const timer = setInterval(() => void loadFirst(true), LIST_POLL_MS);
      return () => clearInterval(timer);
    }, [loadFirst]),
  );

  const refresh = async () => {
    setRefreshing(true);
    await loadFirst(false);
    setRefreshing(false);
  };

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await chatApi.list(cursor);
      setItems((list) => {
        const seen = new Set(list.map((c) => c.id));
        return [...list, ...page.items.filter((c) => !seen.has(c.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      // Scrolling again retries.
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading) return <LoadingState />;
  if (error && items.length === 0) return <ErrorState message={error} onRetry={refresh} />;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <FlatList
        testID="conversation-list"
        data={items}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.3}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} /> : null}
        ListEmptyComponent={
          <EmptyState
            icon="💬"
            title="Henüz mesajın yok"
            body={
              role === 'CUSTOMER'
                ? 'Bir teklif aldığında ustayla o talep hakkında buradan yazışabilirsin.'
                : 'Bir talebe teklif verdiğinde müşteriyle o talep hakkında buradan yazışabilirsin.'
            }
          />
        }
        renderItem={({ item }) => (
          <ConversationRow c={item} onPress={() => router.push(`/messages/${item.id}`)} />
        )}
      />
    </SafeAreaView>
  );
}

function ConversationRow({ c, onPress }: { c: ConversationListItem; onPress: () => void }) {
  const unread = c.unreadCount > 0;
  const when = c.lastMessage?.createdAt ?? c.updatedAt;
  return (
    <Pressable
      testID={`conversation-${c.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${c.counterpart.name}, ${c.title}. ${lastMessagePreview(c)}${
        unread ? `. ${c.unreadCount} okunmamış mesaj` : ''
      }`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, unread && styles.rowUnread, pressed && styles.pressed]}
    >
      <Text style={styles.icon} accessibilityElementsHidden importantForAccessibility="no">
        {categoryIcon(c.category.slug)}
      </Text>
      <View style={styles.flex}>
        <View style={styles.line}>
          <Text style={[styles.name, unread && styles.bold]} numberOfLines={1}>
            {c.counterpart.name}
          </Text>
          <Small>{timeAgo(when)}</Small>
        </View>
        <Small>
          {c.category.name} · {c.title}
        </Small>
        <View style={styles.line}>
          <Text style={[styles.preview, unread && styles.bold]} numberOfLines={1}>
            {lastMessagePreview(c)}
          </Text>
          {unread ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{c.unreadCount > 99 ? '99+' : c.unreadCount}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 72,
  },
  rowUnread: { borderColor: colors.primary },
  pressed: { opacity: 0.8 },
  icon: { fontSize: 26 },
  flex: { flex: 1, gap: 2 },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontSize: 16, color: colors.textPrimary, fontWeight: '600' },
  bold: { fontWeight: '800' },
  preview: { flex: 1, fontSize: 14, color: colors.textPrimary },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.textInverse, fontSize: 12, fontWeight: '800' },
});
