import type { Opportunity } from '@ustago/types';
import { StyleSheet, Text, View } from 'react-native';

import { Badge } from '../../components/Badge';
import { Card } from '../../components/Card';
import { Small } from '../../components/Text';
import { categoryIcon } from '../../lib/categories';
import { timeAgo } from '../../lib/format';
import { colors, spacing } from '../../lib/theme';
import { budgetRangeLabel, distanceLabel, SCHEDULE_OPTION } from './labels';

/**
 * One row of "Sana Uygun İşler". Only the approximate location
 * (district / province) is ever shown: no street, building or customer.
 */
export function OpportunityCard({ o, onPress }: { o: Opportunity; onPress: () => void }) {
  const distance = distanceLabel(o.distance);
  const isNew = o.dispatch !== null && o.dispatch.viewedAt === null;
  const place = `${o.location.district.name} / ${o.location.province.name}`;
  const schedule = o.scheduleOption ? SCHEDULE_OPTION[o.scheduleOption] : null;
  const budget = budgetRangeLabel(o.budget, o.budgetMax);
  const a11y = [
    o.type === 'NOW' ? 'Acil iş' : null,
    isNew ? 'Yeni' : null,
    o.isPreferredForMe ? 'Sana özel' : null,
    o.title,
    o.category.name,
    place,
    distance,
    `Bütçe ${budget}`,
    schedule,
    o.photoCount > 0 ? `${o.photoCount} fotoğraf` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Card
      testID={`opportunity-${o.id}`}
      onPress={onPress}
      highlight={o.type === 'NOW' ? 'emergency' : o.isPreferredForMe ? 'primary' : undefined}
      accessibilityLabel={a11y}
    >
      <View style={styles.badges}>
        {o.type === 'NOW' ? <Badge label="🚨 ACİL" tone="danger" /> : null}
        {isNew ? <Badge label="Yeni" tone="info" /> : null}
        {o.isPreferredForMe ? <Badge label="⭐ Sana özel" tone="success" /> : null}
      </View>
      <View style={styles.row}>
        <Text style={styles.icon} accessibilityElementsHidden importantForAccessibility="no">
          {categoryIcon(o.category.slug)}
        </Text>
        <View style={styles.flex}>
          <Text style={styles.title} numberOfLines={1}>
            {o.title}
          </Text>
          <Small>
            {o.category.name} · {place}
          </Small>
        </View>
      </View>
      <View style={styles.meta}>
        {distance ? (
          <Text style={styles.metaText} testID={`distance-${o.id}`}>
            📍 {distance}
          </Text>
        ) : null}
        {schedule ? <Text style={styles.metaText}>🗓 {schedule}</Text> : null}
        {o.photoCount > 0 ? <Text style={styles.metaText}>📷 {o.photoCount}</Text> : null}
      </View>
      <View style={styles.rowBetween}>
        <Text style={styles.budget}>{budget}</Text>
        <Small>{o.publishedAt ? timeAgo(o.publishedAt) : ''}</Small>
      </View>
      {o.myQuoteId ? <Small>Bu işe teklif verdin.</Small> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  flex: { flex: 1 },
  icon: { fontSize: 26 },
  title: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  metaText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  budget: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
});
