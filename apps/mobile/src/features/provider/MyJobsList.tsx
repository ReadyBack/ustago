import type { JobListItem, Paginated } from '@ustago/types';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { jobApi } from '../../api/services';
import { Badge } from '../../components/Badge';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { Small } from '../../components/Text';
import { useApi } from '../../hooks/useApi';
import { categoryIcon } from '../../lib/categories';
import { formatMoney, timeAgo } from '../../lib/format';
import { JOB_STATUS } from '../../lib/labels';
import { colors, spacing } from '../../lib/theme';

/** "Aktif İşler" / "Geçmiş" segments of İşler. */
export function MyJobsList({ scope }: { scope: 'ACTIVE' | 'FINISHED' }) {
  const router = useRouter();
  const jobs = useApi<Paginated<JobListItem>>(
    `jobs:PROVIDER:${scope}`,
    () => jobApi.list('PROVIDER', scope),
    { pollMs: 15_000 },
  );
  return (
    <Screen onRefresh={jobs.refresh} refreshing={jobs.refreshing}>
      {jobs.loading ? (
        <LoadingState />
      ) : jobs.error ? (
        <ErrorState message={jobs.error} onRetry={jobs.refresh} />
      ) : jobs.data?.items.length === 0 ? (
        <EmptyState
          icon="📅"
          title={scope === 'ACTIVE' ? 'Aktif işin yok' : 'Geçmiş işin yok'}
          body={
            scope === 'ACTIVE'
              ? 'Bir teklifin kabul edildiğinde iş burada görünür.'
              : 'Tamamlanan veya iptal edilen işlerin burada listelenir.'
          }
        />
      ) : (
        jobs.data?.items.map((j) => {
          const status = JOB_STATUS[j.status];
          return (
            <Card
              key={j.id}
              testID={`job-${j.id}`}
              onPress={() => router.push(`/job/${j.id}`)}
              highlight={scope === 'ACTIVE' ? 'success' : undefined}
            >
              <View style={styles.row}>
                <Text style={styles.icon}>{categoryIcon(j.category.slug)}</Text>
                <View style={styles.flex}>
                  <Text style={styles.title} numberOfLines={1}>
                    {j.title}
                  </Text>
                  <Small>
                    {j.counterpart} · {j.location.district.name} · {timeAgo(j.createdAt)}
                  </Small>
                </View>
              </View>
              <View style={styles.rowBetween}>
                <Text style={styles.price}>{formatMoney(j.currentTotal)}</Text>
                <Badge label={status.label} tone={status.tone} />
              </View>
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  flex: { flex: 1 },
  icon: { fontSize: 26 },
  title: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  price: { fontSize: 20, fontWeight: '800', color: colors.textPrimary },
});
