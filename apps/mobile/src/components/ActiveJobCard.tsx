import type { JobListItem } from '@ustago/types';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { categoryIcon } from '../lib/categories';
import { formatMoney } from '../lib/format';
import { JOB_STATUS } from '../lib/labels';
import { colors, spacing } from '../lib/theme';
import { Badge } from './Badge';
import { Button } from './Button';
import { Card } from './Card';
import { Small } from './Text';

/** "AKTİF İŞİNİZ" on the customer home, "AKTİF İŞ" on the provider home. */
export function ActiveJobCard({
  job,
  viewer,
}: {
  job: JobListItem;
  viewer: 'CUSTOMER' | 'PROVIDER';
}) {
  const router = useRouter();
  const status = JOB_STATUS[job.status];
  const open = () => router.push(`/job/${job.id}`);
  return (
    <Card
      testID={`active-job-${job.id}`}
      highlight={job.requestType === 'NOW' ? 'emergency' : 'primary'}
    >
      <Text style={styles.kicker}>{viewer === 'CUSTOMER' ? 'AKTİF İŞİNİZ' : 'AKTİF İŞ'}</Text>
      <View style={styles.row}>
        <Text style={styles.icon}>{categoryIcon(job.category.slug)}</Text>
        <View style={styles.flex}>
          <Text style={styles.title} numberOfLines={1}>
            {job.title}
          </Text>
          <Small>
            {job.counterpart} · {job.location.district.name}
          </Small>
        </View>
      </View>
      <View style={styles.rowBetween}>
        <Badge label={status.label} tone={status.tone} />
        <Text style={styles.price}>{formatMoney(job.currentTotal)}</Text>
      </View>
      <Button
        title={viewer === 'CUSTOMER' ? 'İŞİ GÖR' : 'İŞİ AÇ'}
        onPress={open}
        accessibilityLabel={`${job.title} işini aç`}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  kicker: { fontSize: 12, fontWeight: '800', letterSpacing: 1, color: colors.primaryDark },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  flex: { flex: 1 },
  icon: { fontSize: 26 },
  title: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  price: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
});
