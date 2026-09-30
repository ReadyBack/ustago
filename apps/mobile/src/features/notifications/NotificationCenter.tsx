import type { AppNotification, Paginated } from '@ustago/types';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { notificationV2Api } from '../../api/customer-v2';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { EmptyState, ErrorState, FormError, LoadingState } from '../../components/States';
import { Small } from '../../components/Text';
import { useApi } from '../../hooks/useApi';
import { useSubmit } from '../../hooks/useSubmit';
import { timeAgo } from '../../lib/format';
import { notificationTarget } from '../../lib/notification-target';
import { colors, radii, spacing } from '../../lib/theme';
import { refreshBadges } from '../customer/useBadges';
import { categoryForTab, filterByTab, NOTIFICATION_TABS, type NotificationTab } from './tabs';

const EMPTY: Record<NotificationTab, string> = {
  ALL: 'Teklifler, mesajlar, ustanın yola çıkması, ödemeler ve hesap bildirimleri burada görünür.',
  JOBS: 'Ustanın yola çıkması, ek iş onayı ve tamamlama bildirimleri burada görünür.',
  QUOTES: 'Talebine gelen teklifler ve pazarlık adımları burada görünür.',
  MESSAGES: 'Ustalardan gelen yeni mesajlar burada görünür.',
  FINANCE: 'Ödeme ve iade bildirimleri burada görünür.',
  ACCOUNT: 'Hesabınla ilgili bildirimler burada görünür.',
};

/**
 * Notification centre V2: category tabs, unread styling, "Tümünü okundu
 * işaretle" and deep links. The in-app list is the source of truth; push
 * is a best-effort copy.
 */
export function NotificationCenter() {
  const router = useRouter();
  const [tab, setTab] = useState<NotificationTab>('ALL');
  const category = categoryForTab(tab);
  const first = useApi<Paginated<AppNotification>>(
    `notifications:${category ?? 'ALL'}`,
    () => notificationV2Api.list({ category }),
    { pollMs: 30_000 },
  );
  const [older, setOlder] = useState<AppNotification[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  /** Rows read in this session, before the next reload confirms it. */
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [allReadAt, setAllReadAt] = useState<string | null>(null);
  const next = cursor === undefined ? (first.data?.nextCursor ?? null) : cursor;

  const selectTab = (t: NotificationTab) => {
    setTab(t);
    setOlder([]);
    setCursor(undefined);
  };

  const more = useSubmit(async () => {
    if (!next) return;
    const page = await notificationV2Api.list({ category, cursor: next });
    setOlder((o) => [...o, ...page.items]);
    setCursor(page.nextCursor);
  });
  const readAll = useSubmit(async () => {
    await notificationV2Api.markRead();
    setAllReadAt(new Date().toISOString());
    refreshBadges();
    await first.refresh();
  });
  const open = useSubmit(async (n: AppNotification) => {
    if (!n.readAt && !readIds.has(n.id)) {
      await notificationV2Api.markRead([n.id]);
      setReadIds((s) => new Set(s).add(n.id));
      refreshBadges();
    }
    const target = notificationTarget(n);
    if (target) router.push(target);
  });

  const items = useMemo(() => {
    const firstItems = first.data?.items ?? [];
    const merged = [...firstItems, ...older.filter((o) => !firstItems.some((f) => f.id === o.id))];
    return filterByTab(merged, tab).map((n) =>
      !n.readAt && (readIds.has(n.id) || (allReadAt && n.createdAt <= allReadAt))
        ? { ...n, readAt: allReadAt ?? new Date().toISOString() }
        : n,
    );
  }, [first.data, older, tab, readIds, allReadAt]);
  const unread = items.some((n) => !n.readAt);

  const onRefresh = useCallback(() => {
    setOlder([]);
    setCursor(undefined);
    void first.refresh();
  }, [first]);

  const header = (
    <View style={styles.header}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}
        accessibilityRole="tablist"
      >
        {NOTIFICATION_TABS.map((t) => (
          <Chip
            key={t.value}
            label={t.label}
            selected={tab === t.value}
            onPress={() => selectTab(t.value)}
          />
        ))}
      </ScrollView>
      <View style={styles.actions}>
        {unread ? (
          <Button
            testID="mark-all-read"
            title="Tümünü okundu işaretle"
            variant="ghost"
            loading={readAll.busy}
            onPress={() => void readAll.submit()}
          />
        ) : null}
        <Button
          testID="open-notification-preferences"
          title="⚙️ Tercihler"
          variant="ghost"
          accessibilityLabel="Bildirim tercihleri"
          onPress={() => router.push('/notifications/preferences')}
        />
      </View>
      <FormError message={readAll.error ?? open.error} />
    </View>
  );

  const renderItem = ({ item: n }: { item: AppNotification }) => (
    <Pressable
      testID={`notification-${n.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${n.readAt ? '' : 'Okunmamış. '}${n.title}. ${n.body}`}
      onPress={() => void open.submit(n)}
      style={({ pressed }) => [styles.item, !n.readAt && styles.unread, pressed && styles.pressed]}
    >
      {!n.readAt ? <View style={styles.dot} /> : null}
      <View style={styles.flex}>
        <Text style={[styles.title, !n.readAt && styles.bold]}>{n.title}</Text>
        <Text style={styles.body} numberOfLines={3}>
          {n.body}
        </Text>
        <Small>{timeAgo(n.createdAt)}</Small>
      </View>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <FlatList
        data={first.loading || first.error ? [] : items}
        keyExtractor={(n) => n.id}
        renderItem={renderItem}
        ListHeaderComponent={header}
        contentContainerStyle={styles.content}
        refreshing={first.refreshing}
        onRefresh={onRefresh}
        ListEmptyComponent={
          first.loading ? (
            <LoadingState />
          ) : first.error ? (
            <ErrorState message={first.error} onRetry={first.refresh} />
          ) : (
            <EmptyState icon="🔔" title="Bildirim yok" body={EMPTY[tab]} />
          )
        }
        ListFooterComponent={
          next && !first.loading ? (
            <View style={styles.footer}>
              <Button
                title="Daha eski bildirimler"
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
  header: { gap: spacing.xs, marginBottom: spacing.xs },
  tabs: { gap: spacing.sm, paddingVertical: spacing.xs },
  actions: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap' },
  footer: { gap: spacing.sm, marginTop: spacing.sm },
  item: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    minHeight: 64,
  },
  unread: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  pressed: { opacity: 0.8 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, marginTop: 6 },
  flex: { flex: 1, gap: 2 },
  title: { fontSize: 15, color: colors.textPrimary },
  bold: { fontWeight: '700' },
  body: { fontSize: 14, color: colors.textSecondary },
});
