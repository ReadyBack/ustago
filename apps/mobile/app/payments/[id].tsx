import type { MyPaymentDetail } from '@ustago/types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { paymentApi } from '../../src/api/finance';
import { Badge } from '../../src/components/Badge';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { InfoRow } from '../../src/components/InfoRow';
import { Screen } from '../../src/components/Screen';
import { ErrorState, LoadingState } from '../../src/components/States';
import { TestModeBanner } from '../../src/components/TestModeBanner';
import { Heading, Small } from '../../src/components/Text';
import { useApi } from '../../src/hooks/useApi';
import { anyPaymentStatus, PAYMENT_METHOD_LABEL, paymentStatus } from '../../src/lib/finance';
import { formatDateTime, formatMoney } from '../../src/lib/format';
import { spacing } from '../../src/lib/theme';

/** Ödeme Özeti: a summary of one payment for the customer. Not a legal document. */
export default function PaymentSummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const detail = useApi<MyPaymentDetail>(`my-payment:${id}`, () => paymentApi.mineDetail(id));

  if (detail.loading) return <LoadingState />;
  if (detail.error || !detail.data)
    return <ErrorState message={detail.error ?? 'Ödeme bulunamadı.'} onRetry={detail.refresh} />;
  const p = detail.data;
  const status = anyPaymentStatus(p.status);

  return (
    <Screen onRefresh={detail.refresh} refreshing={detail.refreshing}>
      {p.testMode ? <TestModeBanner /> : null}
      <Card testID="payment-summary">
        <Badge label={status.label} tone={status.tone} />
        <Heading>Ödeme Özeti</Heading>
        <Small>{p.title}</Small>
        <InfoRow label="Usta" value={p.providerName} />
        <InfoRow label="Ödeme yöntemi" value={PAYMENT_METHOD_LABEL[p.method]} />
        <InfoRow label="İş toplamı" value={formatMoney(p.jobTotal)} />
        <InfoRow label="Ödenen tutar" value={formatMoney(p.amount)} />
        {p.refunded.amountMinor > 0 ? (
          <InfoRow label="İade edilen" value={`−${formatMoney(p.refunded)}`} />
        ) : null}
        <InfoRow label="Net" value={formatMoney(p.net)} strong />
        <InfoRow label="Oluşturulma" value={formatDateTime(p.createdAt)} />
        {p.completedAt ? (
          <InfoRow label="Tamamlanma" value={formatDateTime(p.completedAt)} />
        ) : null}
        <Small>
          Bu özet bilgilendirme amaçlıdır; resmi bir belge değildir.
          {p.testMode ? ' Test ortamında gerçek ücret alınmaz.' : ''}
        </Small>
      </Card>

      {p.attempts.length > 0 ? (
        <Card>
          <Heading>Ödeme denemeleri</Heading>
          {p.attempts.map((a) => {
            const s = paymentStatus(a.status);
            return (
              <View key={a.id} style={styles.row}>
                <View style={styles.flex}>
                  <Small>
                    {a.attemptNumber}. deneme · {formatDateTime(a.completedAt ?? a.createdAt)}
                  </Small>
                </View>
                <Badge label={s.label} tone={s.tone} />
              </View>
            );
          })}
        </Card>
      ) : null}

      <Button title="İşe git" variant="secondary" onPress={() => router.push(`/job/${p.jobId}`)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 2 },
  flex: { flex: 1 },
});
