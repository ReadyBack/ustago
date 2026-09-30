import type { Job } from '@ustago/types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, StyleSheet } from 'react-native';

import { jobApi } from '../../src/api/services';
import { Badge } from '../../src/components/Badge';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { InfoRow } from '../../src/components/InfoRow';
import { JobTimeline } from '../../src/components/JobTimeline';
import { Screen } from '../../src/components/Screen';
import { ErrorState, FormError, LoadingState } from '../../src/components/States';
import { Body, Heading, Small } from '../../src/components/Text';
import { TextField } from '../../src/components/TextField';
import { type ApiState, useApi } from '../../src/hooks/useApi';
import { categoryIcon } from '../../src/lib/categories';
import { confirm } from '../../src/lib/confirm';
import { formatDateTime, formatMoney, formatPhone } from '../../src/lib/format';
import { DISPUTE_REASONS, DISPUTE_STATUS, JOB_STATUS } from '../../src/lib/labels';
import { colors } from '../../src/lib/theme';
import { ChangeOrders } from '../../src/screens/job/ChangeOrders';
import { DisputeForm } from '../../src/screens/job/DisputeForm';
import { PaymentCard } from '../../src/screens/job/PaymentCard';
import { ReviewSection } from '../../src/screens/job/ReviewForm';
import { useJobAction } from '../../src/screens/job/useJobAction';

/** Statuses before the provider reached the address. */
const BEFORE_ARRIVAL = new Set<Job['status']>([
  'CREATED',
  'CONFIRMED',
  'PROVIDER_PREPARING',
  'PROVIDER_EN_ROUTE',
]);

export default function JobDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // The other side moves the job too: refresh while the screen is open.
  const job = useApi<Job>(`job:${id}`, () => jobApi.get(id), { pollMs: 10_000 });

  if (job.loading) return <LoadingState />;
  if (job.error || !job.data)
    return <ErrorState message={job.error ?? 'İş bulunamadı.'} onRetry={job.refresh} />;
  const j = job.data;
  const status = JOB_STATUS[j.status];
  const changed = j.currentTotal.amountMinor !== j.agreedPrice.amountMinor;

  return (
    <Screen onRefresh={job.refresh} refreshing={job.refreshing}>
      <Card highlight={j.serviceRequest.type === 'NOW' ? 'emergency' : 'success'}>
        <Badge
          label={j.serviceRequest.type === 'NOW' ? `🚨 ACİL İŞ · ${status.label}` : status.label}
          tone={status.tone}
        />
        <Heading>{j.serviceRequest.title}</Heading>
        <Small>
          {categoryIcon(j.category.slug)} {j.category.name} · {formatDateTime(j.createdAt)}
        </Small>
        <InfoRow label="Anlaşılan fiyat" value={formatMoney(j.agreedPrice)} strong={!changed} />
        {changed ? (
          <InfoRow label="Güncel toplam" value={formatMoney(j.currentTotal)} strong />
        ) : null}
        {j.scheduledStartAt ? (
          <InfoRow label="Başlangıç" value={formatDateTime(j.scheduledStartAt)} />
        ) : null}
        <Small>
          Fiyat anlaşma anında kilitlendi. Yalnızca müşterinin onayladığı ek işler toplama eklenir.
        </Small>
      </Card>

      <ActionsPanel job={job} />
      <ChangeOrders job={job} />
      <PaymentCard job={j} />
      <ReviewSection job={job} />
      {j.viewerRole === 'CUSTOMER' && j.status === 'COMPLETED' ? (
        <RehireButton jobId={j.id} />
      ) : null}

      <Card>
        <Heading>İş adımları</Heading>
        <JobTimeline timeline={j.timeline} />
        {j.cancelledAt ? (
          <Small>
            İptal edildi · {formatDateTime(j.cancelledAt)} ·{' '}
            {j.cancellationActor === 'CUSTOMER' ? 'Müşteri' : 'Usta'}
            {j.cancellationReason ? ` · ${j.cancellationReason}` : ''}
          </Small>
        ) : null}
      </Card>

      <Counterpart job={j} />

      <Card>
        <Heading>Adres</Heading>
        <Body>
          {j.address.addressLine}
          {j.address.buildingNo ? `, No: ${j.address.buildingNo}` : ''}
          {j.address.apartmentNo ? `, Daire: ${j.address.apartmentNo}` : ''}
        </Body>
        <Small>
          {j.address.neighborhood ? `${j.address.neighborhood}, ` : ''}
          {j.address.district.name} / {j.address.province.name}
        </Small>
        {j.address.instructions ? <Small>Tarif: {j.address.instructions}</Small> : null}
      </Card>
    </Screen>
  );
}

/** Faz 7: a new request prefilled from this job (GET /jobs/:id/rehire); this job is untouched. */
function RehireButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  return (
    <Button
      testID="rehire-job"
      title="🔁 Bu ustayı tekrar çağır"
      variant="secondary"
      accessibilityHint="Aynı usta ve hizmet için yeni bir talep başlatır"
      onPress={() => router.push({ pathname: '/request/new', params: { rehireJobId: jobId } })}
    />
  );
}

/**
 * The single next step for the viewer, with the danger actions (cancel,
 * report a problem) kept secondary and behind a confirmation.
 */
function ActionsPanel({ job }: { job: ApiState<Job> }) {
  const [form, setForm] = useState<'dispute' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');
  const j = job.data;
  const step = useJobAction(job, (next: () => Promise<Job>) => next());
  if (!j) return null;
  const a = j.actions;
  const provider = j.viewerRole === 'PROVIDER';
  const pendingCo = j.changeOrders.some((c) => c.status === 'PENDING');

  if (form === 'dispute') {
    return (
      <DisputeForm
        job={job}
        noShowOnly={BEFORE_ARRIVAL.has(j.status)}
        onClose={() => setForm(null)}
      />
    );
  }

  const primary = (() => {
    if (provider && a.enRoute) {
      return (
        <Button
          testID="action-en-route"
          title="YOLA ÇIKTIM"
          loading={step.busy}
          onPress={() =>
            confirm(
              'Yola çıktınız mı?',
              'Müşteriye “Ustanız yola çıktı” bildirimi gider.',
              () => void step.submit(() => jobApi.enRoute(j.id)),
            )
          }
        />
      );
    }
    if (provider && a.arrive) {
      return (
        <Button
          testID="action-arrive"
          title="ADRESE ULAŞTIM"
          loading={step.busy}
          onPress={() => void step.submit(() => jobApi.arrive(j.id))}
        />
      );
    }
    if (provider && a.start) {
      return (
        <Button
          testID="action-start"
          title="İŞE BAŞLADIM"
          loading={step.busy}
          onPress={() => void step.submit(() => jobApi.start(j.id))}
        />
      );
    }
    if (provider && j.status === 'IN_PROGRESS') {
      return (
        <>
          <Button
            testID="action-request-completion"
            title="İŞİ TAMAMLADIM"
            loading={step.busy}
            disabled={!a.requestCompletion}
            onPress={() =>
              confirm(
                'İşi tamamladınız mı?',
                'İşi tamamladığınızı müşteriye bildirmek istiyor musunuz?',
                () => void step.submit(() => jobApi.requestCompletion(j.id)),
                { yes: 'Bildir' },
              )
            }
          />
          {pendingCo ? <Small>Önce bekleyen ek iş talebinin sonuçlanması gerekiyor.</Small> : null}
        </>
      );
    }
    if (!provider && a.complete) {
      return (
        <Button
          testID="action-complete"
          title="İŞ TAMAMLANDI"
          loading={step.busy}
          onPress={() =>
            confirm(
              'İş tamamlandı mı?',
              `İşin tamamlandığını onaylıyorsunuz. Toplam: ${formatMoney(j.currentTotal)}.`,
              () => void step.submit(() => jobApi.complete(j.id)),
              { yes: 'Onayla' },
            )
          }
        />
      );
    }
    return null;
  })();

  const info = infoLine(j);
  const showDispute = !provider && a.dispute;

  if (!primary && !info && !showDispute && !a.cancel && !j.dispute) return null;

  return (
    <Card highlight="primary" testID="job-actions">
      {info ? <Body>{info}</Body> : null}
      {primary}
      {showDispute ? (
        <Button
          testID="action-dispute"
          title={BEFORE_ARRIVAL.has(j.status) ? 'Usta gelmedi' : 'SORUN BİLDİR'}
          variant="danger"
          disabled={step.busy}
          onPress={() => setForm('dispute')}
        />
      ) : null}
      {j.dispute ? <DisputeInfo job={j} /> : null}
      {a.cancel && form !== 'cancel' ? (
        <Button
          testID="action-cancel"
          title="İşi iptal et"
          variant="ghost"
          disabled={step.busy}
          onPress={() => setForm('cancel')}
        />
      ) : null}
      {form === 'cancel' ? (
        <>
          <TextField
            testID="cancel-reason"
            label="İptal nedeni"
            value={reason}
            onChangeText={setReason}
            maxLength={500}
            placeholder="Kısaca yazın"
          />
          <Button
            testID="confirm-cancel"
            title="İptal et"
            variant="danger"
            loading={step.busy}
            onPress={() => {
              if (reason.trim().length < 3) {
                step.setError('Lütfen iptal nedenini yazın.');
                return;
              }
              confirm(
                'İş iptal edilsin mi?',
                'Bu işlem geri alınamaz; karşı tarafa bildirim gider.',
                () =>
                  void step.submit(async () => {
                    const next = await jobApi.cancel(j.id, reason.trim());
                    setForm(null);
                    return next;
                  }),
                { yes: 'İptal et', destructive: true },
              );
            }}
          />
          <Button title="Vazgeç" variant="ghost" onPress={() => setForm(null)} />
        </>
      ) : null}
      <FormError message={step.error} />
    </Card>
  );
}

function infoLine(j: Job): string | null {
  const provider = j.viewerRole === 'PROVIDER';
  switch (j.status) {
    case 'CREATED':
    case 'CONFIRMED':
    case 'PROVIDER_PREPARING':
      return provider
        ? 'Yola çıktığınızda müşteriye haber verin.'
        : 'Ustanızın yola çıkması bekleniyor.';
    case 'PROVIDER_EN_ROUTE':
      return provider ? 'Adrese vardığınızda bildirin.' : 'Ustanız yolda.';
    case 'PROVIDER_ARRIVED':
      return provider ? 'İşe başladığınızda bildirin.' : 'Ustanız adrese ulaştı.';
    case 'IN_PROGRESS':
      return provider ? null : 'İş sürüyor.';
    case 'AWAITING_COMPLETION_CONFIRMATION':
      return provider
        ? 'Müşterinin onayı bekleniyor.'
        : 'Ustanız işi tamamladığını bildirdi. Lütfen kontrol edin.';
    case 'COMPLETED':
      return 'İş tamamlandı.';
    case 'DISPUTED':
      return 'Sorun bildirildi. UstaGO ekibi inceliyor.';
    case 'CANCELLED':
      return 'İş iptal edildi.';
  }
}

function DisputeInfo({ job }: { job: Job }) {
  const d = job.dispute;
  if (!d) return null;
  const s = DISPUTE_STATUS[d.status];
  const reason = DISPUTE_REASONS.find((r) => r.value === d.reason)?.label ?? d.reason;
  return (
    <Card style={styles.inner}>
      <Badge label={s.label} tone={s.tone} />
      <Body>
        {reason}: {d.description}
      </Body>
      {d.resolution ? <Body muted>Karar: {d.resolution}</Body> : null}
      <Small>{formatDateTime(d.createdAt)}</Small>
    </Card>
  );
}

function Counterpart({ job }: { job: Job }) {
  const router = useRouter();
  const customer = job.viewerRole === 'CUSTOMER';
  const other = customer
    ? { title: 'Usta', name: job.provider.displayName, phone: job.provider.phone }
    : { title: 'Müşteri', name: job.customer.name, phone: job.customer.phone };
  const finished = job.status === 'COMPLETED' || job.status === 'CANCELLED';
  return (
    <Card>
      <Heading>{other.title}</Heading>
      <Body>{other.name}</Body>
      {!finished && other.phone ? (
        <>
          <InfoRow label="Telefon" value={formatPhone(other.phone)} />
          <Button
            testID="call-counterpart"
            title="📞 Ara"
            variant="secondary"
            accessibilityLabel={`${other.name} kişisini ara`}
            onPress={() => void Linking.openURL(`tel:${other.phone}`)}
          />
        </>
      ) : null}
      {customer ? (
        <Button
          title="Usta profilini gör"
          variant="ghost"
          onPress={() => router.push(`/usta/${job.provider.id}`)}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  inner: { backgroundColor: colors.surface },
});
