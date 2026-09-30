import type { Paginated, ServiceRequestListItem } from '@ustago/types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { requestApi } from '../../src/api/services';
import { Badge } from '../../src/components/Badge';
import { Card } from '../../src/components/Card';
import { Chip } from '../../src/components/Chip';
import { Screen } from '../../src/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/States';
import { Small } from '../../src/components/Text';
import { useApi } from '../../src/hooks/useApi';
import { categoryIcon } from '../../src/lib/categories';
import { formatBudget, formatMoney, timeAgo } from '../../src/lib/format';
import { REQUEST_STATUS } from '../../src/lib/labels';
import { colors, spacing } from '../../src/lib/theme';

type Group = 'OPEN' | 'AGREED' | 'CLOSED';
const GROUPS: { value: Group; label: string }[] = [
  { value: 'OPEN', label: 'Açık' },
  { value: 'AGREED', label: 'Anlaşılan' },
  { value: 'CLOSED', label: 'Kapanan' },
];

export default function MyRequests() {
  const router = useRouter();
  const [group, setGroup] = useState<Group>('OPEN');
  const list = useApi<Paginated<ServiceRequestListItem>>(
    `requests:${group}`,
    () => requestApi.mine(group),
    { pollMs: 15_000 },
  );

  return (
    <Screen onRefresh={list.refresh} refreshing={list.refreshing}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {GROUPS.map((g) => (
          <Chip
            key={g.value}
            label={g.label}
            selected={group === g.value}
            onPress={() => setGroup(g.value)}
          />
        ))}
      </View>
      {list.loading ? (
        <LoadingState />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.refresh} />
      ) : list.data?.items.length === 0 ? (
        <EmptyState
          icon="📋"
          title={group === 'OPEN' ? 'Açık talebiniz yok' : 'Burada henüz bir şey yok'}
          body={
            group === 'OPEN' ? 'Ana sayfadan bir hizmet seçip talep oluşturabilirsiniz.' : undefined
          }
          action={
            group === 'OPEN'
              ? { title: 'Talep oluştur', onPress: () => router.push('/customer') }
              : undefined
          }
        />
      ) : (
        list.data?.items.map((r) => {
          const status = REQUEST_STATUS[r.status];
          return (
            <Card
              key={r.id}
              testID={`request-${r.id}`}
              onPress={() => router.push(`/request/${r.id}`)}
              accessibilityLabel={`${r.title}, ${status.label}`}
              highlight={r.type === 'NOW' && r.status === 'MATCHING' ? 'emergency' : undefined}
            >
              <View style={styles.row}>
                <Text style={styles.icon}>{categoryIcon(r.category.slug)}</Text>
                <View style={styles.flex}>
                  <Text style={styles.title} numberOfLines={1}>
                    {r.title}
                  </Text>
                  <Small>
                    {r.category.name} · {r.location.district.name} · {timeAgo(r.createdAt)}
                  </Small>
                </View>
              </View>
              <View style={styles.rowBetween}>
                <Badge
                  label={r.type === 'NOW' ? `🚨 ${status.label}` : status.label}
                  tone={status.tone}
                />
                <Text style={styles.meta}>
                  {r.agreedPrice
                    ? `Anlaşılan: ${formatMoney(r.agreedPrice)}`
                    : r.openQuoteCount > 0
                      ? `${r.openQuoteCount} teklif`
                      : formatBudget(r.budget)}
                </Text>
              </View>
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  flex: { flex: 1 },
  icon: { fontSize: 26 },
  title: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  meta: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
});
