import type { Quote, ServiceRequestType } from '@ustago/types';
import { formatMoney } from '@ustago/validation';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ApiError } from '../../api/client';
import { providerV2Api } from '../../api/provider-v2';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Chip } from '../../components/Chip';
import { FormError } from '../../components/States';
import { Heading, Small } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { useSubmit } from '../../hooks/useSubmit';
import { colors, spacing } from '../../lib/theme';
import { QUOTE_ETA_OPTIONS, trDateText } from './labels';
import {
  buildQuotePayload,
  computeBreakdown,
  EMPTY_QUOTE_FORM,
  QUOTE_LINES,
  type QuoteFormValues,
} from './quote-form';

/** "Teklif ver" V2: price lines, computed total, arrival estimate and a note. */
export function QuoteForm({
  requestId,
  requestType,
  onCreated,
}: {
  requestId: string;
  requestType: ServiceRequestType;
  onCreated: (quote: Quote) => void;
}) {
  const [v, setV] = useState<QuoteFormValues>(EMPTY_QUOTE_FORM);
  const breakdown = computeBreakdown(v.lines);

  const send = useSubmit(async () => {
    const built = buildQuotePayload(v);
    if (!built.ok) throw new ApiError(400, 'INVALID_QUOTE', built.error);
    onCreated(await providerV2Api.createQuote(requestId, built.body));
  });

  return (
    <Card>
      <Heading>Teklif ver</Heading>
      <Small>
        Fiyatını işin gerçek maliyetine göre belirle; müşterinin bütçesi bir tavan değildir. Toplam,
        kalemlerin toplamıdır.
        {requestType === 'NOW'
          ? ' Acil işlerde pazarlık yoktur: müşteri teklifini kabul eder veya reddeder.'
          : ''}
      </Small>
      {QUOTE_LINES.map((line) => (
        <TextField
          key={line.key}
          testID={`quote-line-${line.key}`}
          label={`${line.label}${line.key === 'labor' ? '' : ' (isteğe bağlı)'}`}
          prefix="₺"
          placeholder={line.placeholder}
          keyboardType="decimal-pad"
          inputMode="decimal"
          value={v.lines[line.key]}
          onChangeText={(t) => setV((s) => ({ ...s, lines: { ...s.lines, [line.key]: t } }))}
          error={breakdown.invalidLine === line.key ? '1.500 veya 1500,50 biçiminde yazın.' : null}
        />
      ))}
      <View style={styles.totalRow} accessibilityLiveRegion="polite">
        <Text style={styles.totalLabel}>Toplam</Text>
        <Text style={styles.total} testID="quote-total">
          {breakdown.total !== null ? formatMoney(breakdown.total) : '—'}
        </Text>
      </View>

      <Text style={styles.label}>Ne zaman gelebilirsin?</Text>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {QUOTE_ETA_OPTIONS.map((o) => (
          <Chip
            key={o.value}
            label={o.label}
            selected={v.eta === o.value}
            onPress={() => setV((s) => ({ ...s, eta: o.value }))}
          />
        ))}
      </View>
      <Small>Bu senin tahminin; müşteriye aynen gösterilir.</Small>
      {v.eta === 'CUSTOM' ? (
        <View style={styles.row}>
          <View style={styles.flex}>
            <TextField
              testID="quote-custom-date"
              label="Tarih"
              placeholder={trDateText(1)}
              value={v.customDate}
              onChangeText={(t) => setV((s) => ({ ...s, customDate: t }))}
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <View style={styles.flex}>
            <TextField
              testID="quote-custom-time"
              label="Saat"
              placeholder="09:00"
              value={v.customTime}
              onChangeText={(t) => setV((s) => ({ ...s, customTime: t }))}
              keyboardType="numbers-and-punctuation"
            />
          </View>
        </View>
      ) : null}

      <TextField
        label="Tahmini süre (dakika, isteğe bağlı)"
        keyboardType="number-pad"
        inputMode="numeric"
        value={v.durationText}
        onChangeText={(t) => setV((s) => ({ ...s, durationText: t.replace(/\D/g, '') }))}
        placeholder="120"
      />
      <TextField
        testID="quote-note"
        label="Mesajın (isteğe bağlı)"
        value={v.note}
        onChangeText={(t) => setV((s) => ({ ...s, note: t }))}
        multiline
        maxLength={2000}
        placeholder="Örn. Gaz dolumu ve bakım dahil"
      />
      <FormError message={send.error} />
      <Button
        testID="send-quote"
        title="Teklifi Gönder"
        variant={requestType === 'NOW' ? 'emergency' : 'primary'}
        loading={send.busy}
        disabled={breakdown.total === null}
        onPress={() => void send.submit()}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  totalLabel: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  total: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  label: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
