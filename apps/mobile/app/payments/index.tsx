import type { MyPaymentListItem, Paginated } from '@ustago/types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { paymentApi } from '../../src/api/finance';
import { Badge } from '../../src/components/Badge';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Screen } from '../../src/components/Screen';
import { EmptyState, ErrorState, FormError, LoadingState } from '../../src/components/States';
import { Small } from '../../src/components/Text';
import { useApi } from '../../src/hooks/useApi';
import { useSubmit } from '../../src/hooks/useSubmit';
import { anyPaymentStatus, PAYMENT_METHOD_LABEL } from '../../src/lib/finance';
import { formatDateTime, formatMoney } from '../../src/lib/format';
import { colors, spacing } from '../../src/lib/theme';

/** Ödemelerim: the customer's online payments and cash settlements, newest first. */
export default function MyPayments() {
  const router = useRouter();
  const first = useApi<Paginated<MyPaymentListItem>>('my-payments', () => paymentApi.mine());
  const [older, setOlder] = useState<MyPaymentListItem[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const next = cursor === undefined ? (first.data?.nextCursor ?? null) : cursor;

  const more = useSubmit(async () => {
    if (!next) return;
    const page = await paymentApi.mine(next);
    setOlder((o) => [...o, ...page.items]);
    setCursor(page.nextCursor);
  });

  if (first.loading) return <LoadingState />;
  if (first.error) return <ErrorState message={first.error} onRetry={first.refresh} />;
  const items = [
    ...(first.data?.items ?? []),
    ...older.filter((o) => !first.data?.items.some((f) => f.id === o.id)),
  ];

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
          icon="💳"
          title="Henüz ödemeniz yok"
          body="Bir işin ödemesini uygulamadan yaptığınızda veya ustaya doğrudan ödediğinizi onayladığınızda burada görünür."
        />
      ) : (
        <>
          {items.map((p) => {
            const status = anyPaymentStatus(p.status);
            return (
              <Card
                key={p.id}
                testID={`my-payment-${p.id}`}
                accessibilityLabel={`${p.title}, ${formatMoney(p.amount)}, ${status.label}`}
                onPress={() => router.push(`/payments/${p.id}`)}
              >
                <View style={styles.row}>
                  <View style={styles.flex}>
                    <Text style={styles.title} numberOfLines={1}>
                      {p.title}
                    </Text>
                    <Small>
                      {PAYMENT_METHOD_LABEL[p.method]} · {formatDateTime(p.createdAt)}
                    </Small>
                  </View>
                </View>
                <View style={styles.rowBetween}>
                  <Text style={styles.price}>{formatMoney(p.amount)}</Text>
                  <Badge label={status.label} tone={status.tone} />
                </View>
                {p.refunded.amountMinor > 0 ? (
                  <Small>İade edilen: {formatMoney(p.refunded)}</Small>
                ) : null}
              </Card>
            );
          })}
          {next ? (
            <Button
              title="Daha eski ödemeler"
              variant="secondary"
              loading={more.busy}
              onPress={() => void more.submit()}
            />
          ) : null}
          <FormError message={more.error} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  flex: { flex: 1 },
  title: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  price: { fontSize: 20, fontWeight: '800', color: colors.textPrimary },
});
