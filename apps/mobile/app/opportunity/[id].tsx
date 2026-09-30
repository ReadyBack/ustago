import type { Opportunity } from '@ustago/types';
import { MIN_PRICE_MINOR, parseTryInput } from '@ustago/validation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { ApiError } from '../../src/api/client';
import { providerApi, quoteApi } from '../../src/api/services';
import { Badge } from '../../src/components/Badge';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { InfoRow } from '../../src/components/InfoRow';
import { Screen } from '../../src/components/Screen';
import { ErrorState, FormError, LoadingState } from '../../src/components/States';
import { TextField } from '../../src/components/TextField';
import { Body, Heading, Small } from '../../src/components/Text';
import { useApi } from '../../src/hooks/useApi';
import { useSubmit } from '../../src/hooks/useSubmit';
import { categoryIcon } from '../../src/lib/categories';
import { formatBudget, formatDateRange, formatMoney, timeAgo } from '../../src/lib/format';
import { colors, spacing } from '../../src/lib/theme';

export default function OpportunityDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const opp = useApi<Opportunity>(`opportunity:${id}`, () => providerApi.opportunity(id));
  const [priceText, setPriceText] = useState('');
  const [materials, setMaterials] = useState(true);
  const [durationText, setDurationText] = useState('');
  const [note, setNote] = useState('');

  const send = useSubmit(async () => {
    const totalMinor = parseTryInput(priceText);
    if (totalMinor === null || totalMinor < MIN_PRICE_MINOR) {
      throw new ApiError(400, 'INVALID_AMOUNT', 'Fiyatı 2.500 veya 2500,50 biçiminde yazın.');
    }
    const minutes = durationText.trim() ? Number.parseInt(durationText, 10) : null;
    if (minutes !== null && (!Number.isFinite(minutes) || minutes < 5)) {
      throw new ApiError(400, 'INVALID_DURATION', 'Süreyi dakika olarak yazın (en az 5).');
    }
    const quote = await quoteApi.create(id, {
      totalMinor,
      materialsIncluded: materials,
      estimatedDurationMinutes: minutes,
      note: note.trim() || null,
    });
    router.replace(`/quote/${quote.id}`);
  });

  if (opp.loading) return <LoadingState />;
  if (opp.error || !opp.data)
    return <ErrorState message={opp.error ?? 'İş bulunamadı.'} onRetry={opp.refresh} />;
  const o = opp.data;
  const preview = parseTryInput(priceText);

  return (
    <Screen>
      <Card highlight={o.type === 'NOW' ? 'emergency' : undefined}>
        {o.type === 'NOW' ? <Badge label="🚨 ACİL İŞ" tone="danger" /> : null}
        <Heading>{o.title}</Heading>
        <Small>
          {categoryIcon(o.category.slug)} {o.category.name} · {o.location.district.name} /{' '}
          {o.location.province.name}
        </Small>
        <Body>{o.description}</Body>
        <InfoRow label="Müşterinin tahmini bütçesi" value={formatBudget(o.budget)} />
        {o.preferredStartAt ? (
          <InfoRow
            label="Tercih edilen zaman"
            value={formatDateRange(o.preferredStartAt, o.preferredEndAt)}
          />
        ) : null}
        {o.photos.length > 0 ? (
          <InfoRow label="Fotoğraf" value={`${o.photos.length} adet`} />
        ) : null}
        <InfoRow label="Yayınlandı" value={o.publishedAt ? timeAgo(o.publishedAt) : '—'} />
        <Small>Açık adres ve müşteri bilgileri, anlaşma sağlandığında gösterilir.</Small>
      </Card>

      {o.myQuoteId ? (
        <Button title="Teklifinize git" onPress={() => router.replace(`/quote/${o.myQuoteId}`)} />
      ) : (
        <Card>
          <Heading>Teklif ver</Heading>
          <Small>
            Fiyatınızı işin gerçek maliyetine göre belirleyin; müşterinin bütçesi bir tavan
            değildir.
            {o.type === 'NOW'
              ? ' Acil işlerde pazarlık yoktur: müşteri teklifinizi kabul eder veya reddeder.'
              : ''}
          </Small>
          <TextField
            testID="quote-price"
            label="Toplam fiyat"
            prefix="₺"
            placeholder="2.500"
            keyboardType="decimal-pad"
            inputMode="decimal"
            value={priceText}
            onChangeText={setPriceText}
            hint={
              preview !== null ? `Müşteriye ${formatMoney(preview)} olarak görünecek.` : undefined
            }
          />
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Malzeme fiyata dahil</Text>
            <Switch
              value={materials}
              onValueChange={setMaterials}
              accessibilityLabel="Malzeme fiyata dahil"
            />
          </View>
          <TextField
            label="Tahmini süre (dakika, isteğe bağlı)"
            keyboardType="number-pad"
            inputMode="numeric"
            value={durationText}
            onChangeText={(t) => setDurationText(t.replace(/\D/g, ''))}
            placeholder="120"
          />
          <TextField
            label="Not (isteğe bağlı)"
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={2000}
            placeholder="Örn. Gaz dolumu ve bakım dahil"
          />
          <FormError message={send.error} />
          <Button
            testID="send-quote"
            title="Teklifi Gönder"
            variant={o.type === 'NOW' ? 'emergency' : 'primary'}
            loading={send.busy}
            disabled={priceText.trim() === ''}
            onPress={() => void send.submit()}
          />
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 48,
    gap: spacing.sm,
  },
  switchLabel: { fontSize: 16, color: colors.textPrimary },
});
