import type { Quote, QuoteRevision } from '@ustago/types';
import { MIN_PRICE_MINOR, parseTryInput } from '@ustago/validation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ApiError } from '../../src/api/client';
import { quoteApi } from '../../src/api/services';
import { useAuth } from '../../src/auth/AuthContext';
import { Badge } from '../../src/components/Badge';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { ProviderInfo } from '../../src/components/ProviderInfo';
import { Screen } from '../../src/components/Screen';
import { ErrorState, FormError, LoadingState } from '../../src/components/States';
import { TextField } from '../../src/components/TextField';
import { Body, Heading, Small } from '../../src/components/Text';
import { useApi } from '../../src/hooks/useApi';
import { useSubmit } from '../../src/hooks/useSubmit';
import { confirm } from '../../src/lib/confirm';
import { formatDuration, formatMoney, timeAgo } from '../../src/lib/format';
import { quoteStatusLabel, REVISION_KIND } from '../../src/lib/labels';
import { colors, radii, spacing } from '../../src/lib/theme';

export default function QuoteThread() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const quote = useApi<Quote>(`quote:${id}`, () => quoteApi.get(id), { pollMs: 10_000 });
  const [counterText, setCounterText] = useState('');
  const [note, setNote] = useState('');

  // A stale revision means the other side moved first: show their move.
  const onStale = async (e: unknown) => {
    if (
      e instanceof ApiError &&
      (e.code === 'QUOTE_REVISION_STALE' || e.code === 'NOT_YOUR_TURN')
    ) {
      await quote.refresh();
      throw new ApiError(
        e.status,
        e.code,
        'Karşı taraf yeni bir teklif yaptı. Güncel fiyatı kontrol edin.',
      );
    }
    throw e;
  };

  const accept = useSubmit(async (q: Quote) => {
    try {
      quote.setData(await quoteApi.accept(q.id, q.latest.revisionNo));
    } catch (e) {
      await onStale(e);
    }
  });
  const counter = useSubmit(async (q: Quote) => {
    const minor = parseTryInput(counterText);
    if (minor === null || minor < MIN_PRICE_MINOR) {
      throw new ApiError(400, 'INVALID_AMOUNT', 'Tutarı 2.000 veya 2000,50 biçiminde yazın.');
    }
    try {
      quote.setData(
        await quoteApi.counter(q.id, minor, q.latest.revisionNo, note.trim() || undefined),
      );
      setCounterText('');
      setNote('');
    } catch (e) {
      await onStale(e);
    }
  });
  const close = useSubmit(async (q: Quote, as: 'CUSTOMER' | 'PROVIDER') => {
    quote.setData(as === 'CUSTOMER' ? await quoteApi.reject(q.id) : await quoteApi.withdraw(q.id));
  });

  if (quote.loading) return <LoadingState />;
  if (quote.error || !quote.data) {
    return <ErrorState message={quote.error ?? 'Teklif bulunamadı.'} onRetry={quote.refresh} />;
  }
  const q = quote.data;
  const viewer = user?.providerProfile?.id === q.provider.id ? 'PROVIDER' : 'CUSTOMER';
  const status = quoteStatusLabel(q.status, viewer);
  const price = formatMoney(q.latest.total);
  const error = accept.error ?? counter.error ?? close.error;

  return (
    <Screen onRefresh={quote.refresh} refreshing={quote.refreshing}>
      <Card>
        {viewer === 'CUSTOMER' ? (
          <ProviderInfo provider={q.provider} />
        ) : (
          <Heading>Teklifiniz</Heading>
        )}
        <View style={styles.row}>
          <Badge
            label={q.requestType === 'NOW' ? `🚨 ACİL · ${status.label}` : status.label}
            tone={status.tone}
          />
          <Small>{q.revisions.length}. adım</Small>
        </View>
      </Card>

      {q.status === 'ACCEPTED' ? (
        <Card highlight="success">
          <Heading>✅ Anlaşma sağlandı</Heading>
          <Body>
            Fiyat{' '}
            {formatMoney(
              q.revisions.find((r) => r.id === q.acceptedRevisionId)?.total ?? q.latest.total,
            )}{' '}
            olarak kilitlendi ve iş oluşturuldu.
          </Body>
          {q.jobId ? (
            <Button
              testID="open-job"
              title="İşi görüntüle"
              onPress={() => router.push(`/job/${q.jobId}`)}
            />
          ) : null}
        </Card>
      ) : null}

      <Heading>Pazarlık geçmişi</Heading>
      <View style={styles.timeline} accessibilityLabel="Pazarlık geçmişi">
        {q.revisions.map((r) => (
          <Bubble
            key={r.id}
            revision={r}
            mine={r.by === viewer}
            accepted={r.id === q.acceptedRevisionId}
          />
        ))}
      </View>

      {q.turn && q.turn !== viewer && q.status !== 'ACCEPTED' ? (
        <Card style={styles.waiting}>
          <Body muted>
            {viewer === 'CUSTOMER' ? 'Ustanın yanıtı bekleniyor.' : 'Müşterinin yanıtı bekleniyor.'}{' '}
            Bu ekran kendiliğinden yenilenir.
          </Body>
        </Card>
      ) : null}

      {q.actions.accept ? (
        <Button
          testID="accept-quote"
          title={`✓ ${price} ile Anlaş`}
          loading={accept.busy}
          onPress={() =>
            confirm(
              'Teklifi kabul et',
              `${price} fiyat kilitlenecek ve iş oluşturulacak.${viewer === 'CUSTOMER' ? ' Diğer teklifler kapanır.' : ''}`,
              () => void accept.submit(q),
              { yes: 'Kabul et' },
            )
          }
        />
      ) : null}

      {q.actions.counter ? (
        <Card>
          <Heading>Karşı teklif</Heading>
          <TextField
            testID="counter-input"
            label="Önerdiğiniz fiyat"
            prefix="₺"
            placeholder="2.000"
            keyboardType="decimal-pad"
            inputMode="decimal"
            value={counterText}
            onChangeText={setCounterText}
          />
          <TextField
            label="Not (isteğe bağlı)"
            value={note}
            onChangeText={setNote}
            maxLength={500}
            placeholder="Örn. Malzemeyi ben alırım"
          />
          <Button
            testID="send-counter"
            title="Karşı Teklif Gönder"
            variant="secondary"
            loading={counter.busy}
            disabled={counterText.trim() === ''}
            onPress={() => void counter.submit(q)}
          />
        </Card>
      ) : null}

      {q.requestType === 'NOW' && q.status === 'PENDING_CUSTOMER' && viewer === 'CUSTOMER' ? (
        <Small>
          Acil işlerde pazarlık yoktur: ilk teklifi kabul edebilir ya da reddedebilirsiniz.
        </Small>
      ) : null}

      <FormError message={error} />

      {q.actions.reject ? (
        <Button
          title="Teklifi Reddet"
          variant="danger"
          loading={close.busy}
          onPress={() =>
            confirm(
              'Teklifi reddet',
              'Bu usta bu talep için tekrar teklif veremez.',
              () => void close.submit(q, 'CUSTOMER'),
              { yes: 'Reddet', destructive: true },
            )
          }
        />
      ) : null}
      {q.actions.withdraw ? (
        <Button
          title="Teklifimi Geri Çek"
          variant="danger"
          loading={close.busy}
          onPress={() =>
            confirm(
              'Teklifi geri çek',
              'Bu talebe tekrar teklif veremezsiniz.',
              () => void close.submit(q, 'PROVIDER'),
              { yes: 'Geri çek', destructive: true },
            )
          }
        />
      ) : null}
    </Screen>
  );
}

function Bubble({
  revision,
  mine,
  accepted,
}: {
  revision: QuoteRevision;
  mine: boolean;
  accepted: boolean;
}) {
  const duration = formatDuration(revision.estimatedDurationMinutes);
  return (
    <View
      style={[styles.bubble, mine ? styles.mine : styles.theirs, accepted && styles.accepted]}
      accessible
      accessibilityLabel={`${mine ? 'Siz' : revision.by === 'PROVIDER' ? 'Usta' : 'Müşteri'}: ${formatMoney(revision.total)}${revision.note ? `, not: ${revision.note}` : ''}`}
    >
      <Text style={styles.bubbleKind}>
        {mine ? 'Siz' : revision.by === 'PROVIDER' ? 'Usta' : 'Müşteri'} ·{' '}
        {REVISION_KIND[revision.kind]}
      </Text>
      <Text style={styles.bubblePrice}>{formatMoney(revision.total)}</Text>
      {revision.labor && revision.material ? (
        <Text style={styles.bubbleMeta}>
          İşçilik {formatMoney(revision.labor)} + malzeme {formatMoney(revision.material)}
        </Text>
      ) : null}
      {revision.materialsIncluded !== null || duration ? (
        <Text style={styles.bubbleMeta}>
          {revision.materialsIncluded === true
            ? 'Malzeme dahil'
            : revision.materialsIncluded === false
              ? 'Malzeme hariç'
              : ''}
          {revision.materialsIncluded !== null && duration ? ' · ' : ''}
          {duration ? `Tahmini süre ${duration}` : ''}
        </Text>
      ) : null}
      {revision.note ? <Text style={styles.bubbleNote}>“{revision.note}”</Text> : null}
      <Text style={styles.bubbleTime}>
        {timeAgo(revision.createdAt)}
        {accepted ? ' · ✅ kabul edildi' : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  timeline: { gap: spacing.sm },
  bubble: {
    maxWidth: '85%',
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: 2,
    borderWidth: 1,
  },
  mine: {
    alignSelf: 'flex-end',
    backgroundColor: colors.primarySoft,
    borderColor: colors.primarySoft,
  },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  accepted: { borderColor: colors.success, borderWidth: 2 },
  bubbleKind: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  bubblePrice: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  bubbleMeta: { fontSize: 13, color: colors.textSecondary },
  bubbleNote: { fontSize: 14, color: colors.textPrimary, fontStyle: 'italic', marginTop: 2 },
  bubbleTime: { fontSize: 12, color: colors.muted, marginTop: 2 },
  waiting: { backgroundColor: colors.surface },
});
