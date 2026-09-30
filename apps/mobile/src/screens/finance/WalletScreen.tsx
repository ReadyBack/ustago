import type {
  Paginated,
  ProviderEarning,
  Wallet,
  WalletLine,
  WalletStatement,
} from '@ustago/types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { walletApi } from '../../api/finance';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { InfoRow } from '../../components/InfoRow';
import { Screen } from '../../components/Screen';
import { EmptyState, ErrorState, FormError, LoadingState } from '../../components/States';
import { TestModeBanner } from '../../components/TestModeBanner';
import { Body, Heading, Small } from '../../components/Text';
import { useApi } from '../../hooks/useApi';
import { useSubmit } from '../../hooks/useSubmit';
import {
  earningStatus,
  formatSigned,
  netAfterRefunds,
  WALLET_BUCKET_LABEL,
} from '../../lib/finance';
import { formatDateTime, formatMoney } from '../../lib/format';
import { colors, spacing } from '../../lib/theme';

const PERIOD_LABEL: Record<WalletStatement['period'], string> = {
  THIS_MONTH: 'Bu ay',
  LAST_30_DAYS: 'Son 30 gün',
};

/**
 * Kazançlarım: balances computed by the server from the ledger, period
 * statements, recent movements and per-job earnings.
 */
export function WalletScreen() {
  const router = useRouter();
  const wallet = useApi<Wallet>('wallet', () => walletApi.get(), { pollMs: 30_000 });
  const earnings = useApi<Paginated<ProviderEarning>>('earnings', () => walletApi.earnings());
  const [olderEarnings, setOlderEarnings] = useState<ProviderEarning[]>([]);
  const [earningCursor, setEarningCursor] = useState<string | null | undefined>(undefined);
  const nextEarnings =
    earningCursor === undefined ? (earnings.data?.nextCursor ?? null) : earningCursor;
  const [moves, setMoves] = useState<WalletLine[] | null>(null);
  const [movesCursor, setMovesCursor] = useState<string | null>(null);

  const moreEarnings = useSubmit(async () => {
    if (!nextEarnings) return;
    const page = await walletApi.earnings(nextEarnings);
    setOlderEarnings((o) => [...o, ...page.items]);
    setEarningCursor(page.nextCursor);
  });
  const moreMoves = useSubmit(async () => {
    const page = await walletApi.transactions(moves ? (movesCursor ?? undefined) : undefined);
    setMoves((m) => [...(m ?? []), ...page.items]);
    setMovesCursor(page.nextCursor);
  });

  if (wallet.loading) return <LoadingState />;
  if (wallet.error || !wallet.data)
    return (
      <ErrorState message={wallet.error ?? 'Kazançlar yüklenemedi.'} onRetry={wallet.refresh} />
    );
  const w = wallet.data;
  const b = w.balances;
  const earningItems = [
    ...(earnings.data?.items ?? []),
    ...olderEarnings.filter((o) => !earnings.data?.items.some((f) => f.id === o.id)),
  ];
  const lines = moves ?? w.recent;
  const showMoreMoves = moves === null ? w.recent.length > 0 : movesCursor !== null;

  return (
    <Screen
      onRefresh={() => {
        setOlderEarnings([]);
        setEarningCursor(undefined);
        setMoves(null);
        setMovesCursor(null);
        void wallet.refresh();
        void earnings.refresh();
      }}
      refreshing={wallet.refreshing}
    >
      {w.testMode ? <TestModeBanner /> : null}

      <Card highlight="success" testID="wallet-withdrawable">
        <Small>Çekilebilir</Small>
        <Text style={styles.big}>{formatMoney(b.withdrawable)}</Text>
        {b.platformDebt.amountMinor > 0 ? (
          <Small>
            Platform borcunuz ({formatMoney(b.platformDebt)}) kullanılabilir bakiyenizden düşülür.
          </Small>
        ) : null}
        <Button testID="open-payouts" title="Para Çek" onPress={() => router.push('/payouts')} />
      </Card>

      <Card testID="wallet-balances">
        <Heading>Bakiyeler</Heading>
        <InfoRow label="Bekleyen" value={formatMoney(b.pending)} />
        {b.held.amountMinor > 0 ? (
          <Small>{formatMoney(b.held)} sorun incelemesi nedeniyle bekletiliyor.</Small>
        ) : null}
        <InfoRow label="Kullanılabilir" value={formatMoney(b.available)} />
        <InfoRow label="Ayrılan (para çekme)" value={formatMoney(b.reserved)} />
        <InfoRow label="Platform borcu" value={formatMoney(b.platformDebt)} />
        <InfoRow label="Toplam çekilen" value={formatMoney(b.paidOut)} />
        {w.nextReleaseAt ? (
          <Small>Sonraki serbest kalma: {formatDateTime(w.nextReleaseAt)}</Small>
        ) : b.pending.amountMinor > 0 ? (
          <Small>Bekleyen kazanç, iş onaylanıp bekleme süresi dolunca kullanılabilir olur.</Small>
        ) : null}
      </Card>

      {w.statements.map((st) => (
        <Card key={st.period} testID={`statement-${st.period}`}>
          <Heading>{PERIOD_LABEL[st.period]}</Heading>
          <InfoRow label="Brüt iş tutarı" value={formatMoney(st.grossJobValue)} />
          <InfoRow label="Platform ücretleri" value={`−${formatMoney(st.platformFees)}`} />
          <InfoRow label="Net kazanç" value={formatMoney(st.netEarnings)} strong />
          <InfoRow label="Çekilen" value={formatMoney(st.paidOut)} />
        </Card>
      ))}

      <Card>
        <Heading>Son hareketler</Heading>
        {lines.length === 0 ? (
          <Body muted>Henüz hareket yok.</Body>
        ) : (
          lines.map((line) => (
            <View key={line.transactionId} style={styles.line}>
              <View style={styles.rowBetween}>
                <Body style={styles.bold}>{line.label}</Body>
                <Small>{formatDateTime(line.createdAt)}</Small>
              </View>
              {line.jobTitle ? <Small>{line.jobTitle}</Small> : null}
              {line.changes.map((c) => (
                <Small key={c.bucket}>
                  {WALLET_BUCKET_LABEL[c.bucket]}: {formatSigned(c.amount.amountMinor)}
                </Small>
              ))}
            </View>
          ))
        )}
        {showMoreMoves ? (
          <Button
            title={moves === null ? 'Tüm hareketler' : 'Daha eski hareketler'}
            variant="ghost"
            loading={moreMoves.busy}
            onPress={() => void moreMoves.submit()}
          />
        ) : null}
        <FormError message={moreMoves.error} />
      </Card>

      <Heading>Kazançlarım</Heading>
      {earnings.loading ? (
        <LoadingState />
      ) : earnings.error ? (
        <ErrorState message={earnings.error} onRetry={earnings.refresh} />
      ) : earningItems.length === 0 ? (
        <EmptyState
          icon="💰"
          title="Henüz kazancınız yok"
          body="Tamamlanan işlerinizin kazancı burada görünür."
        />
      ) : (
        <>
          {earningItems.map((e) => {
            const s = earningStatus(e.status);
            return (
              <Card
                key={e.id}
                testID={`earning-${e.id}`}
                accessibilityLabel={`${e.jobTitle}, net ${formatMoney(netAfterRefunds(e))}, ${s.label}`}
                onPress={() => router.push(`/earnings/${e.id}`)}
              >
                <Text style={styles.title} numberOfLines={1}>
                  {e.jobTitle}
                </Text>
                <Small>
                  {e.categoryName} · {formatDateTime(e.createdAt)}
                </Small>
                <View style={styles.rowBetween}>
                  <Text style={styles.price}>{formatMoney(netAfterRefunds(e))}</Text>
                  <Badge label={s.label} tone={s.tone} />
                </View>
              </Card>
            );
          })}
          {nextEarnings ? (
            <Button
              title="Daha eski kazançlar"
              variant="secondary"
              loading={moreEarnings.busy}
              onPress={() => void moreEarnings.submit()}
            />
          ) : null}
          <FormError message={moreEarnings.error} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  big: { fontSize: 32, fontWeight: '800', color: colors.textPrimary },
  line: {
    gap: 2,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  bold: { fontWeight: '700', flexShrink: 1 },
  title: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  price: { fontSize: 20, fontWeight: '800', color: colors.textPrimary },
});
