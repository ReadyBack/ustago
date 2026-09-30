import type { Paginated, Payout, PayoutDestination, Wallet } from '@ustago/types';
import { isValidTrIban, minorToInput, normalizeIban } from '@ustago/validation';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { payoutApi, walletApi } from '../../api/finance';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { InfoRow } from '../../components/InfoRow';
import { Screen } from '../../components/Screen';
import { ErrorState, FormError, LoadingState } from '../../components/States';
import { TestModeBanner } from '../../components/TestModeBanner';
import { Body, Heading, Small } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { useApi } from '../../hooks/useApi';
import { useSubmit } from '../../hooks/useSubmit';
import { confirm } from '../../lib/confirm';
import {
  IntentKey,
  isStaleFinanceError,
  parseAmountMinor,
  payoutStatus,
  toFinanceError,
} from '../../lib/finance';
import { formatDateTime, formatMoney } from '../../lib/format';
import { colors, spacing } from '../../lib/theme';

/**
 * Para Çek: the (test) bank account, a withdrawal request from the
 * withdrawable balance, and the requests made so far.
 */
export function PayoutScreen() {
  const wallet = useApi<Wallet>('wallet', () => walletApi.get());
  const payouts = useApi<Paginated<Payout>>('payouts', () => payoutApi.list(), {
    pollMs: 30_000,
  });
  const [saved, setSaved] = useState<PayoutDestination | null>(null);

  if (wallet.loading) return <LoadingState />;
  if (wallet.error || !wallet.data)
    return <ErrorState message={wallet.error ?? 'Bakiye yüklenemedi.'} onRetry={wallet.refresh} />;
  const w = wallet.data;
  const destination = saved ?? w.destination;
  const reload = async () => {
    await Promise.all([wallet.refresh(), payouts.refresh()]);
  };

  return (
    <Screen onRefresh={() => void reload()} refreshing={wallet.refreshing || payouts.refreshing}>
      {w.testMode ? <TestModeBanner text="TEST ORTAMI — gerçek para transferi yapılmaz" /> : null}
      <Card highlight="success">
        <Small>Çekilebilir</Small>
        <Text style={styles.big} testID="payout-withdrawable">
          {formatMoney(w.balances.withdrawable)}
        </Text>
        <Small>En düşük çekim tutarı: {formatMoney(w.minPayout)}</Small>
      </Card>

      <DestinationCard
        destination={destination}
        testMode={w.testMode}
        onSaved={(d) => setSaved(d)}
      />

      <RequestCard wallet={w} destination={destination} onDone={reload} />

      <Card>
        <Heading>Para çekme taleplerim</Heading>
        {payouts.loading ? (
          <Small>Yükleniyor…</Small>
        ) : payouts.error ? (
          <>
            <FormError message={payouts.error} />
            <Button title="Tekrar dene" variant="ghost" onPress={() => void payouts.refresh()} />
          </>
        ) : (payouts.data?.items.length ?? 0) === 0 ? (
          <Body muted>Henüz para çekme talebiniz yok.</Body>
        ) : (
          payouts.data?.items.map((p) => <PayoutRow key={p.id} payout={p} onChanged={reload} />)
        )}
      </Card>
    </Screen>
  );
}

function DestinationCard({
  destination,
  testMode,
  onSaved,
}: {
  destination: PayoutDestination | null;
  testMode: boolean;
  onSaved: (d: PayoutDestination) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [holderName, setHolderName] = useState('');
  const [iban, setIban] = useState('');
  const [ibanError, setIbanError] = useState<string | null>(null);
  const save = useSubmit(async () => {
    try {
      const next = await payoutApi.setDestination(holderName.trim(), normalizeIban(iban));
      onSaved(next);
      setIban('');
      setEditing(false);
    } catch (e) {
      throw toFinanceError(e);
    }
  });

  if (destination && !editing) {
    return (
      <Card testID="payout-destination">
        <View style={styles.rowBetween}>
          <Heading>Banka hesabı</Heading>
          {destination.isTest || testMode ? <Badge label="TEST hesabı" tone="warning" /> : null}
        </View>
        <Body>{destination.holderName}</Body>
        <Text style={styles.iban} testID="masked-iban">
          {destination.maskedIban}
        </Text>
        <Small>IBAN’ın tamamı saklanmaz; yalnızca son 4 hanesi görünür.</Small>
        <Button
          title="Hesabı değiştir"
          variant="ghost"
          onPress={() => {
            setHolderName(destination.holderName);
            setEditing(true);
          }}
        />
      </Card>
    );
  }

  const onSave = () => {
    save.setError(null);
    if (holderName.trim().length < 3) {
      save.setError('Hesap sahibinin adını yazın.');
      return;
    }
    if (!isValidTrIban(iban)) {
      setIbanError('Geçerli bir TR IBAN girin (TR + 24 rakam).');
      return;
    }
    setIbanError(null);
    void save.submit();
  };

  return (
    <Card testID="payout-destination-form">
      <View style={styles.rowBetween}>
        <Heading>Banka hesabı</Heading>
        {testMode ? <Badge label="TEST hesabı" tone="warning" /> : null}
      </View>
      <Small>
        {testMode
          ? 'Test ortamında gerçek para gönderilmez; test IBAN’ı kullanabilirsiniz.'
          : 'Kazançlarınız bu hesaba gönderilir.'}
      </Small>
      <TextField
        testID="holder-name"
        label="Hesap sahibi"
        value={holderName}
        onChangeText={setHolderName}
        maxLength={120}
        autoComplete="name"
        placeholder="Ad Soyad"
      />
      <TextField
        testID="iban-input"
        label="IBAN"
        value={iban}
        onChangeText={(t) => {
          setIban(t.toUpperCase());
          setIbanError(null);
        }}
        error={ibanError}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={40}
        placeholder="TR00 0000 0000 0000 0000 0000 00"
      />
      <FormError message={save.error} />
      <Button
        testID="save-destination"
        title="Hesabı kaydet"
        loading={save.busy}
        onPress={onSave}
      />
      {destination ? (
        <Button
          title="Vazgeç"
          variant="ghost"
          disabled={save.busy}
          onPress={() => setEditing(false)}
        />
      ) : null}
    </Card>
  );
}

function RequestCard({
  wallet: w,
  destination,
  onDone,
}: {
  wallet: Wallet;
  destination: PayoutDestination | null;
  onDone: () => Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [intent] = useState(() => new IntentKey());
  const request = useSubmit(async (minor: number) => {
    try {
      const payout = await payoutApi.request(minor, intent.current(String(minor)));
      intent.settle();
      setAmount('');
      setDone(`${formatMoney(payout.amount)} için talebiniz alındı.`);
    } catch (e) {
      intent.settle(e);
      if (isStaleFinanceError(e)) await onDone();
      throw toFinanceError(e);
    }
    await onDone();
  });

  const min = w.minPayout.amountMinor;
  const max = w.balances.withdrawable.amountMinor;
  const onSend = () => {
    setDone(null);
    const minor = parseAmountMinor(amount);
    if (minor === null || minor <= 0) {
      request.setError('Tutarı 500 veya 500,50 biçiminde yazın.');
      return;
    }
    if (!destination) {
      request.setError('Önce para çekeceğiniz banka hesabını kaydedin.');
      return;
    }
    if (minor < min) {
      request.setError(`En az ${formatMoney(min)} çekebilirsiniz.`);
      return;
    }
    if (minor > max) {
      request.setError(`En fazla ${formatMoney(max)} çekebilirsiniz.`);
      return;
    }
    request.setError(null);
    confirm(
      `${formatMoney(minor)} çekilsin mi?`,
      `Tutar ${destination.maskedIban} hesabına gönderilmek üzere bakiyenizden ayrılır.`,
      () => void request.submit(minor),
      { yes: 'Talep et' },
    );
  };

  if (!w.payoutsEnabled) {
    return (
      <Card>
        <Heading>Para çek</Heading>
        <Body muted>Para çekme şu anda kapalı. Lütfen daha sonra tekrar deneyin.</Body>
      </Card>
    );
  }

  return (
    <Card testID="payout-request">
      <Heading>Para çek</Heading>
      <TextField
        testID="payout-amount"
        label="Tutar"
        prefix="₺"
        keyboardType="decimal-pad"
        value={amount}
        onChangeText={(t) => {
          setAmount(t);
          setDone(null);
        }}
        placeholder={String(Math.floor(min / 100))}
        hint={`En az ${formatMoney(min)}, en fazla ${formatMoney(max)}`}
      />
      {max > 0 && max >= min ? (
        <Button
          title={`Tümünü çek (${formatMoney(max)})`}
          variant="ghost"
          onPress={() => setAmount(minorToInput(max))}
        />
      ) : null}
      <FormError message={request.error} />
      {done ? (
        <View style={styles.ok} accessibilityRole="alert" testID="payout-done">
          <Body style={styles.okText}>{done}</Body>
        </View>
      ) : null}
      <Button
        testID="request-payout"
        title="Para çekme talebi gönder"
        loading={request.busy}
        disabled={max <= 0}
        onPress={onSend}
      />
    </Card>
  );
}

function PayoutRow({ payout: p, onChanged }: { payout: Payout; onChanged: () => Promise<void> }) {
  const cancel = useSubmit(async () => {
    try {
      await payoutApi.cancel(p.id);
    } catch (e) {
      if (isStaleFinanceError(e)) await onChanged();
      throw toFinanceError(e);
    }
    await onChanged();
  });
  const s = payoutStatus(p.status);
  return (
    <View style={styles.payout} testID={`payout-${p.id}`}>
      <View style={styles.rowBetween}>
        <Text style={styles.amount}>{formatMoney(p.amount)}</Text>
        <Badge label={s.label} tone={s.tone} />
      </View>
      <Small>
        {formatDateTime(p.createdAt)} · {p.destination.maskedIban}
      </Small>
      {p.paidAt ? <InfoRow label="Ödendi" value={formatDateTime(p.paidAt)} /> : null}
      {p.status === 'FAILED' ? (
        <Small>Transfer tamamlanamadı; tutar çekilebilir bakiyenize geri döndü.</Small>
      ) : null}
      {p.status === 'REQUESTED' ? (
        <Button
          testID={`cancel-payout-${p.id}`}
          title="Talebi iptal et"
          variant="ghost"
          loading={cancel.busy}
          onPress={() =>
            confirm(
              'Talep iptal edilsin mi?',
              `${formatMoney(p.amount)} çekilebilir bakiyenize geri döner.`,
              () => void cancel.submit(),
              { yes: 'İptal et', destructive: true },
            )
          }
        />
      ) : null}
      <FormError message={cancel.error} />
    </View>
  );
}

const styles = StyleSheet.create({
  big: { fontSize: 32, fontWeight: '800', color: colors.textPrimary },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iban: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, letterSpacing: 0.5 },
  ok: { backgroundColor: colors.successSoft, borderRadius: 10, padding: spacing.sm + 4 },
  okText: { color: colors.success, fontWeight: '700' },
  payout: {
    gap: 2,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  amount: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
});
