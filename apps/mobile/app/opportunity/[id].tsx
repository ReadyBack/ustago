import type { Opportunity } from '@ustago/types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { chatApi } from '../../src/api/chat';
import { providerV2Api } from '../../src/api/provider-v2';
import { Badge } from '../../src/components/Badge';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { InfoRow } from '../../src/components/InfoRow';
import { Screen } from '../../src/components/Screen';
import { ErrorState, FormError, LoadingState } from '../../src/components/States';
import { Body, Heading, Small } from '../../src/components/Text';
import {
  budgetRangeLabel,
  distanceLabel,
  SCHEDULE_OPTION,
} from '../../src/features/provider/labels';
import { QuoteForm } from '../../src/features/provider/QuoteForm';
import { RequestPhotos } from '../../src/features/provider/RequestPhotos';
import { useApi } from '../../src/hooks/useApi';
import { useSubmit } from '../../src/hooks/useSubmit';
import { categoryIcon } from '../../src/lib/categories';
import { formatDateRange, timeAgo } from '../../src/lib/format';
import { colors, radii, spacing } from '../../src/lib/theme';

/** Opportunity detail V2 (opening it records `viewedAt` on the dispatch). */
export default function OpportunityDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const opp = useApi<Opportunity>(`opportunity:${id}`, () => providerV2Api.opportunity(id));
  const openChat = useSubmit(async (quoteId: string) => {
    const conversation = await chatApi.open({ quoteId });
    router.push(`/messages/${conversation.id}`);
  });

  if (opp.loading) return <LoadingState />;
  if (opp.error || !opp.data)
    return <ErrorState message={opp.error ?? 'İş bulunamadı.'} onRetry={opp.refresh} />;
  const o = opp.data;
  const distance = distanceLabel(o.distance);

  return (
    <Screen onRefresh={opp.refresh} refreshing={opp.refreshing}>
      <Card highlight={o.type === 'NOW' ? 'emergency' : o.isPreferredForMe ? 'primary' : undefined}>
        <View style={styles.badges}>
          {o.type === 'NOW' ? <Badge label="🚨 ACİL İŞ" tone="danger" /> : null}
          {o.isPreferredForMe ? <Badge label="⭐ Sana özel" tone="success" /> : null}
        </View>
        <Heading>{o.title}</Heading>
        <Small>
          {categoryIcon(o.category.slug)} {o.category.name} · {o.location.district.name} /{' '}
          {o.location.province.name}
        </Small>
        <Body>{o.description}</Body>
        <InfoRow
          label="Müşterinin tahmini bütçesi"
          value={budgetRangeLabel(o.budget, o.budgetMax)}
        />
        {o.scheduleOption ? (
          <InfoRow label="Ne zaman" value={SCHEDULE_OPTION[o.scheduleOption]} />
        ) : null}
        {o.preferredStartAt ? (
          <InfoRow
            label="Tercih edilen zaman"
            value={formatDateRange(o.preferredStartAt, o.preferredEndAt)}
          />
        ) : null}
        {distance ? <InfoRow label="Uzaklık (kuş uçuşu)" value={distance} /> : null}
        <InfoRow label="Yayınlandı" value={o.publishedAt ? timeAgo(o.publishedAt) : '—'} />
        {o.isPreferredForMe ? <Small>Müşteri bu talep için özellikle seni seçti.</Small> : null}
      </Card>

      {o.answers.length > 0 ? (
        <Card testID="opportunity-answers">
          <Heading>Müşterinin cevapları</Heading>
          {o.answers.map((a) => (
            <InfoRow key={a.questionId} label={a.label} value={a.displayValue} />
          ))}
        </Card>
      ) : null}

      {o.photoCount > 0 ? (
        <Card>
          <Heading>Fotoğraflar ({o.photoCount})</Heading>
          <RequestPhotos requestId={o.id} photos={o.photos} />
        </Card>
      ) : null}

      <View style={styles.privacy} accessibilityRole="text">
        <Text style={styles.privacyText}>
          🔒 Adres ve telefon, teklifin kabul edilince görünür.
        </Text>
      </View>

      {o.myQuoteId ? (
        <>
          <Button title="Teklifine git" onPress={() => router.push(`/quote/${o.myQuoteId}`)} />
          <Button
            title="Müşteriye mesaj yaz"
            variant="secondary"
            loading={openChat.busy}
            onPress={() => o.myQuoteId && void openChat.submit(o.myQuoteId)}
          />
          <FormError message={openChat.error} />
        </>
      ) : (
        <QuoteForm
          requestId={o.id}
          requestType={o.type}
          onCreated={(quote) => router.replace(`/quote/${quote.id}`)}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  privacy: {
    backgroundColor: colors.primarySoft,
    borderRadius: radii.md,
    padding: spacing.sm + 4,
  },
  privacyText: { fontSize: 14, color: colors.primaryDark, fontWeight: '600' },
});
