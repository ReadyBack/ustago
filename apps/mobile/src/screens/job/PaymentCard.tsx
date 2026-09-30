import type {
  CashSettlement,
  Job,
  JobPaymentSummary,
  MockPaymentOutcome,
  Payment,
  PaymentMethodChoice,
} from '@ustago/types';
import { formatBps } from '@ustago/validation';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { paymentApi } from '../../api/finance';
import { IS_DEV } from '../../api/config';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Chip } from '../../components/Chip';
import { InfoRow } from '../../components/InfoRow';
import { FormError } from '../../components/States';
import { TestModeBanner } from '../../components/TestModeBanner';
import { Body, Heading, Small } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { type ApiState, useApi } from '../../hooks/useApi';
import { useSubmit } from '../../hooks/useSubmit';
import { confirm } from '../../lib/confirm';
import {
  awaitsProviderDecision,
  cashStatus,
  IntentKey,
  isStaleFinanceError,
  PAYMENT_FAILED_MESSAGE,
  PAYMENT_METHOD_LABEL,
  paymentFailureMessage,
  paymentStatus,
  toFinanceError,
} from '../../lib/finance';
import { formatDateTime, formatMoney } from '../../lib/format';
import { colors, radii, spacing } from '../../lib/theme';

type Summary = ApiState<JobPaymentSummary>;

/**
 * "Ödeme" card on the job: what is due, how it is paid and the next payment
 * step. Every amount comes from the server (outstanding = total − paid −
 * in-flight); the app never computes what to charge.
 */
export function PaymentCard({ job }: { job: Job }) {
  const summary = useApi<JobPaymentSummary>(`payment:${job.id}`, () => paymentApi.summary(job.id), {
    pollMs: 10_000,
  });
  // The job moved (completed, extra work accepted…): the payment card follows.
  const { refresh } = summary;
  const version = `${job.status}:${job.currentTotal.amountMinor}`;
  const seen = useRef(version);
  useEffect(() => {
    if (seen.current === version) return;
    seen.current = version;
    void refresh();
  }, [version, refresh]);

  if (summary.loading) return null;
  if (summary.error || !summary.data) {
    return (
      <Card testID="payment-card">
        <Heading>Ödeme</Heading>
        <FormError message={summary.error ?? 'Ödeme bilgisi yüklenemedi.'} />
        <Button title="Tekrar dene" variant="secondary" onPress={() => void summary.refresh()} />
      </Card>
    );
  }
  const s = summary.data;
  if (job.status === 'CANCELLED' && s.payments.length === 0 && !s.cash) return null;

  return (
    <Card testID="payment-card" highlight={s.outstanding.amountMinor > 0 ? 'primary' : undefined}>
      <Heading>Ödeme</Heading>
      {s.testMode ? <TestModeBanner /> : null}
      <Totals summary={s} />
      {s.viewerRole === 'CUSTOMER' ? (
        <CustomerPayment summary={summary} />
      ) : (
        <ProviderPayment summary={s} />
      )}
      {s.method === 'CASH' || s.cash ? <CashPanel summary={summary} /> : null}
      <PaymentHistory summary={s} />
    </Card>
  );
}

function Totals({ summary: s }: { summary: JobPaymentSummary }) {
  return (
    <>
      <InfoRow label="Toplam" value={formatMoney(s.total)} />
      <InfoRow label="Ödenen" value={formatMoney(s.paid)} />
      {s.refunded.amountMinor > 0 ? (
        <InfoRow label="İade edilen" value={formatMoney(s.refunded)} />
      ) : null}
      {s.inFlight && awaitsProviderDecision(s.inFlight) ? (
        <InfoRow label="İşlemde" value={formatMoney(s.inFlight.amount)} />
      ) : null}
      <InfoRow label="Kalan" value={formatMoney(s.outstanding)} strong />
    </>
  );
}

/** Runs a payment action and shows the server's answer; a 409/422 reloads the card. */
function useSummaryAction<A extends unknown[]>(
  summary: Summary,
  action: (...args: A) => Promise<JobPaymentSummary | null>,
) {
  const run = useCallback(
    async (...args: A) => {
      try {
        const next = await action(...args);
        if (next) summary.setData(next);
        else await summary.refresh();
      } catch (e) {
        if (isStaleFinanceError(e)) await summary.refresh();
        throw toFinanceError(e);
      }
    },
    [action, summary],
  );
  return useSubmit(run);
}

type Outcome = { ok: boolean; message: string; detail?: string };

function CustomerPayment({ summary }: { summary: Summary }) {
  const s = summary.data;
  const [intent] = useState(() => new IntentKey());
  /** The payment just started here, until the provider decides it. */
  const [started, setStarted] = useState<Payment | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const choose = useSummaryAction(summary, (method: PaymentMethodChoice) =>
    s ? paymentApi.chooseMethod(s.jobId, method) : Promise.resolve(null),
  );

  const show = (p: Payment) => {
    if (p.status === 'SUCCEEDED') {
      setStarted(null);
      setOutcome({ ok: true, message: `${formatMoney(p.amount)} ödendi. Teşekkürler!` });
    } else if (p.status === 'FAILED' || p.status === 'CANCELLED' || !awaitsProviderDecision(p)) {
      setStarted(null);
      setOutcome({
        ok: false,
        message: PAYMENT_FAILED_MESSAGE,
        detail:
          p.lastFailureCode === 'CARD_DECLINED'
            ? paymentFailureMessage(p.lastFailureCode)
            : undefined,
      });
    } else {
      setStarted(p);
    }
  };

  const pay = useSubmit(async () => {
    if (!s) return;
    setOutcome(null);
    try {
      const payment = await paymentApi.create(s.jobId, intent.current());
      intent.settle();
      show(payment);
    } catch (e) {
      intent.settle(e);
      if (isStaleFinanceError(e)) await summary.refresh();
      throw toFinanceError(e);
    }
    await summary.refresh();
  });

  const decide = useSubmit(async (paymentId: string, result: MockPaymentOutcome) => {
    try {
      show(await paymentApi.simulate(paymentId, result));
    } catch (e) {
      throw toFinanceError(e);
    }
    await summary.refresh();
  });

  if (!s) return null;
  const a = s.actions;
  const inFlight =
    started ?? (s.inFlight && awaitsProviderDecision(s.inFlight) ? s.inFlight : null);
  const options = (['IN_APP', 'CASH'] as const).filter((m) =>
    m === 'IN_APP' ? s.onlineEnabled : s.cashEnabled,
  );
  const canPay = a.canPayOnline && s.outstanding.amountMinor > 0 && !inFlight;
  const payTitle =
    s.paid.amountMinor > 0
      ? `Kalan ${formatMoney(s.outstanding)} ÖDE`
      : `${formatMoney(s.outstanding)} ÖDE`;

  return (
    <>
      {a.canChooseMethod ? (
        <View style={styles.methods} testID="payment-methods">
          <Small>Nasıl ödemek istersiniz?</Small>
          <View style={styles.chips}>
            {options.map((m) => (
              <Chip
                key={m}
                label={PAYMENT_METHOD_LABEL[m]}
                selected={s.method === m}
                onPress={() => {
                  if (s.method !== m) void choose.submit(m);
                }}
              />
            ))}
          </View>
          {choose.busy ? <ActivityIndicator color={colors.primary} /> : null}
          <FormError message={choose.error} />
        </View>
      ) : s.method ? (
        <InfoRow label="Ödeme yöntemi" value={PAYMENT_METHOD_LABEL[s.method]} />
      ) : null}

      {canPay ? (
        <Button
          testID="pay-button"
          title={payTitle}
          loading={pay.busy}
          accessibilityHint="Kalan tutar için güvenli ödeme adımını açar"
          onPress={() => void pay.submit()}
        />
      ) : null}

      {inFlight ? (
        <PendingPayment
          payment={inFlight}
          testMode={s.testMode}
          busy={decide.busy}
          onDecide={(result) => void decide.submit(inFlight.id, result)}
        />
      ) : null}

      {outcome ? (
        <View
          testID={outcome.ok ? 'payment-success' : 'payment-failure'}
          style={[styles.outcome, outcome.ok ? styles.ok : styles.fail]}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          <Body style={outcome.ok ? styles.okText : styles.failText}>{outcome.message}</Body>
          {outcome.detail ? <Small>{outcome.detail}</Small> : null}
        </View>
      ) : null}
      <FormError message={pay.error ?? decide.error} />

      {s.method === 'IN_APP' && s.outstanding.amountMinor === 0 && !inFlight && !outcome ? (
        <Small>Bu işin ödemesi tamamlandı.</Small>
      ) : null}
    </>
  );
}

/**
 * A started payment waiting for the payment provider. With the test
 * provider, a development build shows the test payment step; a release
 * build never does (no simulate buttons outside __DEV__).
 */
function PendingPayment({
  payment,
  testMode,
  busy,
  onDecide,
}: {
  payment: Payment;
  testMode: boolean;
  busy: boolean;
  onDecide: (outcome: MockPaymentOutcome) => void;
}) {
  const showTestStep = testMode && IS_DEV;
  return (
    <View style={styles.pending} testID="payment-pending">
      <Body>
        {formatMoney(payment.amount)} tutarında ödeme başlatıldı.{' '}
        {showTestStep ? 'Test ödeme adımını tamamlayın.' : 'Sonuç birkaç saniye içinde görünür.'}
      </Body>
      {showTestStep ? (
        <>
          <Small>Bu adım gerçek kart sayfasının yerini tutar; kart bilgisi istenmez.</Small>
          <Button
            testID="simulate-success"
            title="Başarılı ödeme (TEST)"
            loading={busy}
            onPress={() => onDecide('SUCCESS')}
          />
          <Button
            testID="simulate-failure"
            title="Başarısız ödeme (TEST)"
            variant="danger"
            disabled={busy}
            onPress={() => onDecide('CARD_DECLINED')}
          />
        </>
      ) : (
        <ActivityIndicator color={colors.primary} />
      )}
    </View>
  );
}

function ProviderPayment({ summary: s }: { summary: JobPaymentSummary }) {
  const b = s.providerBreakdown;
  return (
    <>
      <InfoRow
        label="Ödeme yöntemi"
        value={s.method ? PAYMENT_METHOD_LABEL[s.method] : 'Henüz seçilmedi'}
      />
      {b ? (
        <View style={styles.breakdown} testID="provider-breakdown">
          <InfoRow label="Brüt" value={formatMoney(b.gross)} />
          <InfoRow
            label={`Platform ücreti (${formatBps(b.feeBps)})`}
            value={`−${formatMoney(b.platformFee)}`}
          />
          <InfoRow label="Net kazancınız" value={formatMoney(b.net)} strong />
          {b.developmentPolicy ? (
            <Small>Geliştirme oranı; nihai ticari oran değildir.</Small>
          ) : null}
          {s.method === 'CASH' ? (
            <Small>
              Doğrudan ödemede platform ücreti, onaydan sonra kazançlarınıza borç olarak yazılır.
            </Small>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

/** "Viewer did X" sentence for both sides of a cash settlement. */
function cashLine(cash: CashSettlement | null, customer: boolean): string {
  switch (cash?.status) {
    case undefined:
    case 'AWAITING_CONFIRMATION':
      return customer
        ? 'Ödemeyi ustaya yaptığınızda burada onaylayın.'
        : 'Ödemeyi aldığınızda burada onaylayın.';
    case 'CUSTOMER_CONFIRMED':
      return customer
        ? 'Ödemeyi yaptığınızı bildirdiniz. Ustanın onayı bekleniyor.'
        : 'Müşteri ödemeyi yaptığını bildirdi. Aldıysanız onaylayın.';
    case 'PROVIDER_CONFIRMED':
      return customer
        ? 'Usta ödemeyi aldığını bildirdi. Yaptıysanız onaylayın.'
        : 'Ödemeyi aldığınızı bildirdiniz. Müşterinin onayı bekleniyor.';
    case 'CONFIRMED':
      return 'İki taraf da ödemeyi onayladı.';
    case 'DISPUTED':
      return 'Ödeme için sorun bildirildi. UstaGO ekibi inceliyor.';
    case 'RESOLVED_UNPAID':
      return 'Ödeme yapılmadı olarak kaydedildi.';
  }
}

function CashPanel({ summary }: { summary: Summary }) {
  const s = summary.data;
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState('');
  const confirmCash = useSummaryAction(summary, () =>
    s ? paymentApi.confirmCash(s.jobId) : Promise.resolve(null),
  );
  const dispute = useSummaryAction(summary, async () => {
    if (!s) return null;
    const next = await paymentApi.disputeCash(s.jobId, note.trim());
    setDisputing(false);
    setNote('');
    return next;
  });
  if (!s) return null;
  const customer = s.viewerRole === 'CUSTOMER';
  const cash = s.cash;
  const status = cash ? cashStatus(cash.status) : null;
  const amount = cash?.amount ?? s.outstanding;

  return (
    <View style={styles.cash} testID="cash-panel">
      <View style={styles.row}>
        <Body style={styles.bold}>Ustaya doğrudan ödeme</Body>
        {status ? <Badge label={status.label} tone={status.tone} /> : null}
      </View>
      <Body muted>{cashLine(cash, customer)}</Body>
      {cash ? (
        <>
          <InfoRow
            label="Müşteri"
            value={cash.customerConfirmedAt ? 'Ödedim ✓' : 'Onay bekleniyor'}
          />
          <InfoRow label="Usta" value={cash.providerConfirmedAt ? 'Aldım ✓' : 'Onay bekleniyor'} />
        </>
      ) : null}

      {s.actions.canConfirmCash ? (
        <Button
          testID="confirm-cash"
          title={customer ? 'Ödemeyi yaptım' : 'Ödemeyi aldım'}
          loading={confirmCash.busy}
          onPress={() =>
            confirm(
              customer ? 'Ödemeyi yaptınız mı?' : 'Ödemeyi aldınız mı?',
              customer
                ? `${formatMoney(amount)} tutarını ustaya ödediğinizi onaylıyorsunuz.`
                : `${formatMoney(amount)} tutarını müşteriden aldığınızı onaylıyorsunuz.`,
              () => void confirmCash.submit(),
              { yes: 'Onayla' },
            )
          }
        />
      ) : null}
      {s.actions.canDisputeCash && !disputing ? (
        <Button
          testID="dispute-cash"
          title="Sorun bildir"
          variant="danger"
          disabled={confirmCash.busy}
          onPress={() => setDisputing(true)}
        />
      ) : null}
      {disputing ? (
        <>
          <TextField
            testID="cash-dispute-note"
            label="Ne oldu?"
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={1000}
            placeholder="Örn. ödemeyi yaptım ama usta almadığını söylüyor."
          />
          <Button
            testID="send-cash-dispute"
            title="Sorunu bildir"
            variant="danger"
            loading={dispute.busy}
            onPress={() => {
              if (note.trim().length < 10) {
                dispute.setError('Lütfen durumu en az 10 karakterle açıklayın.');
                return;
              }
              confirm(
                'Sorun bildirilsin mi?',
                'Nakit ödeme “Anlaşmazlık” durumuna geçer ve UstaGO ekibi inceler.',
                () => void dispute.submit(),
                { yes: 'Bildir', destructive: true },
              );
            }}
          />
          <Button
            title="Vazgeç"
            variant="ghost"
            disabled={dispute.busy}
            onPress={() => setDisputing(false)}
          />
        </>
      ) : null}
      <FormError message={confirmCash.error ?? dispute.error} />
    </View>
  );
}

function PaymentHistory({ summary: s }: { summary: JobPaymentSummary }) {
  const router = useRouter();
  if (s.payments.length === 0) return null;
  const customer = s.viewerRole === 'CUSTOMER';
  return (
    <View style={styles.history}>
      <Small>Ödeme hareketleri</Small>
      {s.payments.map((p) => {
        const st = paymentStatus(p.status);
        const settled = p.status === 'SUCCEEDED' || p.status.endsWith('REFUNDED');
        return (
          <View key={p.id} style={styles.historyRow} testID={`payment-${p.id}`}>
            <View style={styles.flex}>
              <Body style={styles.bold}>{formatMoney(p.amount)}</Body>
              <Small>{formatDateTime(p.succeededAt ?? p.createdAt)}</Small>
            </View>
            <Badge label={st.label} tone={st.tone} />
            {customer && settled ? (
              <Button
                title="Ödeme Özeti"
                variant="ghost"
                onPress={() => router.push(`/payments/${p.id}`)}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  methods: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pending: {
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.sm + 4,
  },
  outcome: { borderRadius: radii.sm, padding: spacing.sm + 4, gap: 2 },
  ok: { backgroundColor: colors.successSoft },
  fail: { backgroundColor: colors.emergencySoft },
  okText: { color: colors.success, fontWeight: '700' },
  failText: { color: colors.emergency, fontWeight: '700' },
  breakdown: {
    gap: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  cash: {
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bold: { fontWeight: '700' },
  history: { gap: spacing.xs },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
});
