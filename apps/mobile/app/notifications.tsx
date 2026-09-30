import type { AppNotification, Paginated } from '@ustago/types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { notificationApi } from '../src/api/services';
import { Button } from '../src/components/Button';
import { Screen } from '../src/components/Screen';
import { EmptyState, ErrorState, FormError, LoadingState } from '../src/components/States';
import { Small } from '../src/components/Text';
import { useApi } from '../src/hooks/useApi';
import { useSubmit } from '../src/hooks/useSubmit';
import { timeAgo } from '../src/lib/format';
import { notificationTarget } from '../src/lib/notification-target';
import { colors, radii, spacing } from '../src/lib/theme';

export default function Notifications() {
  const router = useRouter();
  const first = useApi<Paginated<AppNotification>>('notifications', () => notificationApi.list(), {
    pollMs: 20_000,
  });
  const [older, setOlder] = useState<AppNotification[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const next = cursor === undefined ? (first.data?.nextCursor ?? null) : cursor;

  const more = useSubmit(async () => {
    if (!next) return;
    const page = await notificationApi.list(next);
    setOlder((o) => [...o, ...page.items]);
    setCursor(page.nextCursor);
  });
  const readAll = useSubmit(async () => {
    await notificationApi.markRead();
    await first.refresh();
    setOlder((o) => o.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
  });
  const open = useSubmit(async (n: AppNotification) => {
    if (!n.readAt) await notificationApi.markRead([n.id]);
    const target = notificationTarget(n);
    if (target) router.push(target);
    void first.refresh();
  });

  if (first.loading) return <LoadingState />;
  if (first.error) return <ErrorState message={first.error} onRetry={first.refresh} />;
  const items = [
    ...(first.data?.items ?? []),
    ...older.filter((o) => !first.data?.items.some((f) => f.id === o.id)),
  ];
  const unread = items.some((n) => !n.readAt);

  return (
    <Screen
      onRefresh={() => {
        setOlder([]);
        setCursor(undefined);
        void first.refresh();
      }}
      refreshing={first.refreshing}
    >
      {items.length === 0 ? (
        <EmptyState
          icon="🔔"
          title="Bildiriminiz yok"
          body="Teklifler, ustanızın yola çıkması, ek iş onayı ve tamamlama bildirimleri burada görünür."
        />
      ) : (
        <>
          {unread ? (
            <Button
              title="Tümünü okundu işaretle"
              variant="ghost"
              loading={readAll.busy}
              onPress={() => void readAll.submit()}
            />
          ) : null}
          {items.map((n) => (
            <Pressable
              key={n.id}
              testID={`notification-${n.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${n.readAt ? '' : 'Okunmamış. '}${n.title}. ${n.body}`}
              onPress={() => void open.submit(n)}
              style={({ pressed }) => [
                styles.item,
                !n.readAt && styles.unread,
                pressed && styles.pressed,
              ]}
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
          ))}
          {next ? (
            <Button
              title="Daha eski bildirimler"
              variant="secondary"
              loading={more.busy}
              onPress={() => void more.submit()}
            />
          ) : null}
          <FormError message={more.error ?? readAll.error ?? open.error} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  unread: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  pressed: { opacity: 0.8 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, marginTop: 6 },
  flex: { flex: 1, gap: 2 },
  title: { fontSize: 15, color: colors.textPrimary },
  bold: { fontWeight: '700' },
  body: { fontSize: 14, color: colors.textSecondary },
});
