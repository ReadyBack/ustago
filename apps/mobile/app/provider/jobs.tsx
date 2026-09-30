import type { JobListItem, Paginated } from '@ustago/types';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { jobApi } from '../../src/api/services';
import { Badge } from '../../src/components/Badge';
import { Card } from '../../src/components/Card';
import { ProviderGate } from '../../src/components/ProviderGate';
import { Screen } from '../../src/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/States';
import { Small } from '../../src/components/Text';
import { useApi } from '../../src/hooks/useApi';
import { categoryIcon } from '../../src/lib/categories';
import { formatMoney, timeAgo } from '../../src/lib/format';
import { JOB_STATUS } from '../../src/lib/labels';
import { colors, spacing } from '../../src/lib/theme';

export default function MyJobs() {
  return (
    <ProviderGate>
      <JobList />
    </ProviderGate>
  );
}

function JobList() {
  const router = useRouter();
  const jobs = useApi<Paginated<JobListItem>>('jobs:PROVIDER', () => jobApi.list('PROVIDER'), {
    pollMs: 15_000,
  });
  return (
    <Screen onRefresh={jobs.refresh} refreshing={jobs.refreshing}>
      {jobs.loading ? (
        <LoadingState />
      ) : jobs.error ? (
        <ErrorState message={jobs.error} onRetry={jobs.refresh} />
      ) : jobs.data?.items.length === 0 ? (
        <EmptyState
          icon="📅"
          title="Henüz işiniz yok"
          body="Bir teklifiniz kabul edildiğinde iş burada görünür."
        />
      ) : (
        jobs.data?.items.map((j) => {
          const status = JOB_STATUS[j.status];
          return (
            <Card
              key={j.id}
              testID={`job-${j.id}`}
              onPress={() => router.push(`/job/${j.id}`)}
              highlight="success"
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
                <Text style={styles.price}>{formatMoney(j.agreedPrice)}</Text>
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
