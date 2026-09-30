import type { DispatchSummary } from '@ustago/types';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { FormError } from '../../components/States';
import { Heading, Small } from '../../components/Text';
import { formatDateTime } from '../../lib/format';
import { colors, spacing } from '../../lib/theme';
import { dispatchProgressText, preferredProviderText, supplyText } from './text';

/**
 * Where the request stands in dispatch: real counts from the server
 * ("7 uygun ustaya gönderildi · 3 görüntüledi · 1 teklif"), the preferred
 * provider's state, and the customer's own "Arama alanını genişlet".
 */
export function DispatchStatusCard({
  dispatch: d,
  onExpand,
  expanding,
  error,
}: {
  dispatch: DispatchSummary;
  onExpand: () => void;
  expanding: boolean;
  error: string | null;
}) {
  const progress = dispatchProgressText(d);
  const preferred = preferredProviderText(d);
  const supply = supplyText(d);
  return (
    <Card testID="dispatch-status">
      <Heading>Talebinin durumu</Heading>
      {progress ? (
        <Text style={styles.progress} testID="dispatch-progress">
          {progress}
        </Text>
      ) : !supply ? (
        <Small>Talebin uygun ustalara iletiliyor.</Small>
      ) : null}
      {preferred ? <Text style={styles.preferred}>⭐ {preferred}</Text> : null}
      {supply ? (
        <View style={styles.warn} accessibilityRole="alert">
          <Text style={styles.warnText}>{supply}</Text>
        </View>
      ) : null}
      {d.noOfferPrompt ? (
        <View style={styles.warn} testID="no-offer-prompt">
          <Text style={styles.warnText}>
            Henüz teklif gelmedi. Açıklamana fotoğraf veya ayrıntı eklemek ya da arama alanını
            genişletmek teklif alma şansını artırır.
          </Text>
        </View>
      ) : null}
      {d.nextDispatchAt && !d.canExpand ? (
        <Small>Sonraki gönderim: {formatDateTime(d.nextDispatchAt)}</Small>
      ) : null}
      {d.canExpand ? (
        <Button
          testID="expand-search"
          title="Arama alanını genişlet"
          variant="secondary"
          loading={expanding}
          accessibilityHint="Talebini daha geniş bir bölgedeki uygun ustalara da gönderir"
          onPress={onExpand}
        />
      ) : null}
      <FormError message={error} />
    </Card>
  );
}

const styles = StyleSheet.create({
  progress: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  preferred: { fontSize: 14, color: colors.primaryDark, fontWeight: '600' },
  warn: { backgroundColor: colors.warningSoft, borderRadius: 10, padding: spacing.sm + 4 },
  warnText: { fontSize: 14, color: '#9A6200' },
});
