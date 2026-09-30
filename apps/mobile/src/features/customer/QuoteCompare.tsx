import type { Money, Quote } from '@ustago/types';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ProviderInfo } from '../../components/ProviderInfo';
import { Small } from '../../components/Text';
import { formatMoney, timeAgo } from '../../lib/format';
import { quoteStatusLabel } from '../../lib/labels';
import { colors, radii, spacing } from '../../lib/theme';
import { COMPARISON_LABEL, distanceText, etaText, ratingText } from './text';

export const isOpenQuote = (q: Quote) =>
  q.status === 'PENDING_CUSTOMER' || q.status === 'PENDING_PROVIDER';

/** Only the labels the server computed; never an "en iyi" of our own. */
export function ComparisonLabels({ labels }: { labels: Quote['comparisonLabels'] }) {
  if (labels.length === 0) return null;
  return (
    <View style={styles.labels} testID="comparison-labels">
      {labels.map((l) => (
        <Badge key={l} label={COMPARISON_LABEL[l]} tone="info" />
      ))}
    </View>
  );
}

function breakdown(q: Quote): { label: string; money: Money }[] {
  const r = q.latest;
  const rows: { label: string; money: Money | null }[] = [
    { label: 'İşçilik', money: r.labor },
    { label: 'Malzeme', money: r.material },
    { label: 'Hizmet', money: r.service },
    { label: 'Diğer', money: r.other },
  ];
  return rows.flatMap((x) => (x.money ? [{ label: x.label, money: x.money }] : []));
}

/** One offer: provider, total with its parts, arrival estimate, distance and actions. */
export function QuoteOfferCard({
  quote: q,
  onOpen,
  onMessage,
  messaging,
}: {
  quote: Quote;
  onOpen: (q: Quote) => void;
  onMessage: (q: Quote) => void;
  messaging: boolean;
}) {
  const status = quoteStatusLabel(q.status, 'CUSTOMER');
  const eta = etaText(q.latest.arrivalEta, q.latest.availableFrom);
  const distance = distanceText(q.distance);
  const parts = breakdown(q);
  return (
    <Card
      testID={`quote-${q.id}`}
      highlight={
        q.status === 'ACCEPTED' ? 'success' : q.turn === 'CUSTOMER' ? 'primary' : undefined
      }
    >
      <ComparisonLabels labels={q.comparisonLabels} />
      <ProviderInfo provider={q.provider} />
      <View style={styles.between}>
        <Text style={styles.price}>{formatMoney(q.latest.total)}</Text>
        <Badge label={status.label} tone={status.tone} />
      </View>
      {parts.length > 0 ? (
        <View style={styles.parts}>
          {parts.map((p) => (
            <Small key={p.label}>
              {p.label}: {formatMoney(p.money)}
            </Small>
          ))}
        </View>
      ) : null}
      <Small>
        {[
          eta ? `🕒 Varış: ${eta}` : null,
          distance ? `📍 ${distance}` : null,
          q.latest.materialsIncluded ? 'Malzeme dahil' : null,
          q.revisions.length > 1 ? `${q.revisions.length} adım pazarlık` : null,
          timeAgo(q.updatedAt),
        ]
          .filter(Boolean)
          .join(' · ')}
      </Small>
      {q.latest.note ? <Text style={styles.note}>“{q.latest.note}”</Text> : null}
      <View style={styles.actions}>
        <Button
          title="Teklifi incele"
          accessibilityLabel={`${q.provider.displayName} teklifini incele, ${formatMoney(q.latest.total)}`}
          onPress={() => onOpen(q)}
          style={styles.flex}
        />
        <Button
          testID={`message-${q.id}`}
          title="Mesaj gönder"
          variant="secondary"
          accessibilityLabel={`${q.provider.displayName} ustaya mesaj gönder`}
          loading={messaging}
          onPress={() => onMessage(q)}
          style={styles.flex}
        />
      </View>
    </Card>
  );
}

const COL = 200;

/** Side-by-side view of open offers; every row is the provider's own figure. */
export function QuoteComparisonTable({
  quotes,
  onOpen,
}: {
  quotes: Quote[];
  onOpen: (q: Quote) => void;
}) {
  const rows: { label: string; value: (q: Quote) => string }[] = [
    { label: 'Toplam', value: (q) => formatMoney(q.latest.total) },
    { label: 'İşçilik', value: (q) => (q.latest.labor ? formatMoney(q.latest.labor) : '—') },
    {
      label: 'Malzeme',
      value: (q) =>
        q.latest.material
          ? formatMoney(q.latest.material)
          : q.latest.materialsIncluded
            ? 'Dahil'
            : '—',
    },
    { label: 'Hizmet', value: (q) => (q.latest.service ? formatMoney(q.latest.service) : '—') },
    { label: 'Diğer', value: (q) => (q.latest.other ? formatMoney(q.latest.other) : '—') },
    { label: 'Varış', value: (q) => etaText(q.latest.arrivalEta, q.latest.availableFrom) ?? '—' },
    { label: 'Mesafe', value: (q) => distanceText(q.distance) ?? '—' },
    {
      label: 'Puan',
      value: (q) => (q.provider.rating ? `⭐ ${ratingText(q.provider.rating)}` : 'Yeni usta'),
    },
    { label: 'Tamamlanan iş', value: (q) => String(q.provider.completedJobCount) },
  ];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator
      contentContainerStyle={styles.table}
      testID="quote-comparison"
    >
      {quotes.map((q) => (
        <View key={q.id} style={styles.col} accessible={false} testID={`compare-col-${q.id}`}>
          <Text style={styles.colName} numberOfLines={2}>
            {q.provider.displayName}
          </Text>
          <ComparisonLabels labels={q.comparisonLabels} />
          {rows.map((r) => (
            <View
              key={r.label}
              style={styles.cell}
              accessible
              accessibilityLabel={`${q.provider.displayName}, ${r.label}: ${r.value(q)}`}
            >
              <Text style={styles.cellLabel}>{r.label}</Text>
              <Text style={[styles.cellValue, r.label === 'Toplam' && styles.total]}>
                {r.value(q)}
              </Text>
            </View>
          ))}
          <Button title="İncele" variant="secondary" onPress={() => onOpen(q)} />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  labels: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  price: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  parts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md },
  note: { fontSize: 14, color: colors.textSecondary, fontStyle: 'italic' },
  actions: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  table: { gap: spacing.sm, paddingBottom: spacing.xs },
  col: {
    width: COL,
    backgroundColor: colors.background,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm + 4,
    gap: spacing.xs,
  },
  colName: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, minHeight: 40 },
  cell: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 4 },
  cellLabel: { fontSize: 12, color: colors.textSecondary },
  cellValue: { fontSize: 14, color: colors.textPrimary, fontWeight: '600' },
  total: { fontSize: 18, fontWeight: '800' },
});
