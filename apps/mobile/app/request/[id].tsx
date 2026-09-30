import type { Quote, ServiceRequest } from '@ustago/types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { conversationIdForQuote, requestV2Api } from '../../src/api/customer-v2';
import { requestApi } from '../../src/api/services';
import { Badge } from '../../src/components/Badge';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { InfoRow } from '../../src/components/InfoRow';
import { Chip } from '../../src/components/Chip';
import { Screen } from '../../src/components/Screen';
import { EmptyState, ErrorState, FormError, LoadingState } from '../../src/components/States';
import { Body, Heading, Small } from '../../src/components/Text';
import { DispatchStatusCard } from '../../src/features/customer/DispatchStatusCard';
import {
  isOpenQuote,
  QuoteComparisonTable,
  QuoteOfferCard,
} from '../../src/features/customer/QuoteCompare';
import { useApi } from '../../src/hooks/useApi';
import { useSubmit } from '../../src/hooks/useSubmit';
import { categoryIcon } from '../../src/lib/categories';
import { confirm } from '../../src/lib/confirm';
import {
  formatBudget,
  formatDateRange,
  formatDateTime,
  formatMoney,
  timeAgo,
} from '../../src/lib/format';
import { REQUEST_STATUS } from '../../src/lib/labels';
import { spacing } from '../../src/lib/theme';

export default function RequestDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const request = useApi<ServiceRequest>(`request:${id}`, () => requestApi.get(id), {
    pollMs: 10_000,
  });
  const quotes = useApi<Quote[]>(`request-quotes:${id}`, () => requestApi.quotes(id), {
    pollMs: 10_000,
  });

  const [compare, setCompare] = useState(false);
  const [messagingId, setMessagingId] = useState<string | null>(null);
  const expand = useSubmit(async () => {
    request.setData(await requestV2Api.expandSearch(id));
  });
  const message = useSubmit(async (q: Quote) => {
    setMessagingId(q.id);
    try {
      const conversationId = await conversationIdForQuote(q);
      router.push(`/messages/${conversationId}`);
    } finally {
      setMessagingId(null);
    }
  });

  const cancel = useSubmit(async () => {
    const updated = await requestApi.cancel(id);
    request.setData(updated);
    await quotes.refresh();
  });

  if (request.loading) return <LoadingState />;
  if (request.error || !request.data) {
    return <ErrorState message={request.error ?? 'Talep bulunamadı.'} onRetry={request.refresh} />;
  }
  const r = request.data;
  const status = REQUEST_STATUS[r.status];
  const openQuotes = (quotes.data ?? []).filter(isOpenQuote);
  const refresh = async () => {
    await Promise.all([request.refresh(), quotes.refresh()]);
  };

  return (
    <Screen onRefresh={() => void refresh()} refreshing={request.refreshing || quotes.refreshing}>
      <Card highlight={r.type === 'NOW' && r.status === 'MATCHING' ? 'emergency' : undefined}>
        <View style={styles.row}>
          <Badge
            label={r.type === 'NOW' ? `🚨 ACİL · ${status.label}` : status.label}
            tone={r.type === 'NOW' && r.status === 'MATCHING' ? 'danger' : status.tone}
          />
          <Small>{timeAgo(r.createdAt)}</Small>
        </View>
        <Heading>{r.title}</Heading>
        <Small>
          {categoryIcon(r.category.slug)} {r.category.name} · {r.address.district.name} /{' '}
          {r.address.province.name}
        </Small>
        <Body>{r.description}</Body>
        <InfoRow
          label="Tahmini bütçeniz"
          value={
            r.budget && r.budgetMax
              ? `${formatMoney(r.budget)}–${formatMoney(r.budgetMax)}`
              : formatBudget(r.budget)
          }
        />
        {r.preferredStartAt ? (
          <InfoRow
            label="Tercih edilen zaman"
            value={formatDateRange(r.preferredStartAt, r.preferredEndAt)}
          />
        ) : null}
        {r.answers.map((a) => (
          <InfoRow key={a.questionId} label={a.label} value={a.displayValue} />
        ))}
        {r.photos.length > 0 ? (
          <InfoRow label="Fotoğraf" value={`${r.photos.length} adet`} />
        ) : null}
        {r.expiresAt && r.status !== 'MATCHED' ? (
          <InfoRow label="Açık kalma süresi" value={formatDateTime(r.expiresAt)} />
        ) : null}
      </Card>

      {r.dispatch && !r.job && r.status !== 'CANCELLED' && r.status !== 'EXPIRED' ? (
        <DispatchStatusCard
          dispatch={r.dispatch}
          onExpand={() => void expand.submit()}
          expanding={expand.busy}
          error={expand.error}
        />
      ) : null}

      {r.job ? (
        <Card highlight="success">
          <Heading>✅ Anlaştınız</Heading>
          <InfoRow label="Usta" value={r.job.provider.displayName} />
          <InfoRow label="Anlaşılan fiyat" value={formatMoney(r.job.agreedPrice)} strong />
          <Button title="İşi görüntüle" onPress={() => router.push(`/job/${r.job?.id}`)} />
        </Card>
      ) : null}

      <Heading>Gelen Teklifler</Heading>
      {r.budget ? (
        <Small>
          Bütçeniz {formatMoney(r.budget)}. Ustalar farklı fiyat verebilir; karşı teklif
          yapabilirsiniz.
        </Small>
      ) : null}
      {quotes.loading ? (
        <LoadingState label="Teklifler yükleniyor…" />
      ) : quotes.error ? (
        <ErrorState message={quotes.error} onRetry={quotes.refresh} />
      ) : quotes.data?.length === 0 ? (
        <EmptyState
          icon={r.type === 'NOW' ? '🚨' : '⏳'}
          title={
            r.status === 'CANCELLED' || r.status === 'EXPIRED'
              ? 'Teklif gelmedi'
              : 'Teklifler bekleniyor'
          }
          body={
            r.status === 'CANCELLED' || r.status === 'EXPIRED'
              ? undefined
              : r.type === 'NOW'
                ? 'Talebiniz bölgenizde şu an müsait ustalara iletildi. Bu ekran kendiliğinden yenilenir.'
                : 'Talebiniz bölgenizdeki onaylı ustalara görünüyor. Yeni teklifler geldikçe burada listelenir.'
          }
        />
      ) : (
        <>
          {openQuotes.length >= 2 ? (
            <View style={styles.row} accessibilityRole="tablist">
              <Chip label="Liste" selected={!compare} onPress={() => setCompare(false)} />
              <Chip
                label={`Karşılaştır (${openQuotes.length})`}
                selected={compare}
                onPress={() => setCompare(true)}
              />
            </View>
          ) : null}
          {compare && openQuotes.length >= 2 ? (
            <QuoteComparisonTable
              quotes={openQuotes}
              onOpen={(q) => router.push(`/quote/${q.id}`)}
            />
          ) : (
            quotes.data?.map((q) => (
              <QuoteOfferCard
                key={q.id}
                quote={q}
                onOpen={(x) => router.push(`/quote/${x.id}`)}
                onMessage={(x) => void message.submit(x)}
                messaging={messagingId === q.id}
              />
            ))
          )}
          <FormError message={message.error} />
        </>
      )}

      {r.actions.cancel ? (
        <>
          <FormError message={cancel.error} />
          <Button
            title="Talebi İptal Et"
            variant="danger"
            loading={cancel.busy}
            onPress={() =>
              confirm(
                'Talebi iptal et',
                'Açık teklifler kapanır ve ustalara bildirilir.',
                () => void cancel.submit(),
                {
                  yes: 'İptal et',
                  destructive: true,
                },
              )
            }
          />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
