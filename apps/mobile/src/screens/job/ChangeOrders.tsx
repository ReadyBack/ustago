import type { ChangeOrder, Job } from '@ustago/types';
import {
  CHANGE_ORDER_DESCRIPTION_MIN_LENGTH,
  formatMoney,
  MIN_PRICE_MINOR,
  parseTryInput,
} from '@ustago/validation';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { changeOrderApi, jobApi } from '../../api/services';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { InfoRow } from '../../components/InfoRow';
import { FormError } from '../../components/States';
import { Body, Heading, Small } from '../../components/Text';
import { TextField } from '../../components/TextField';
import type { ApiState } from '../../hooks/useApi';
import { confirm } from '../../lib/confirm';
import { formatDateTime } from '../../lib/format';
import { CHANGE_ORDER_STATUS } from '../../lib/labels';
import { spacing } from '../../lib/theme';
import { useJobAction } from './useJobAction';

/** Extra work: history for both sides, answer buttons for the customer, a form for the provider. */
export function ChangeOrders({ job }: { job: ApiState<Job> }) {
  const j = job.data;
  const answer = useJobAction(job, async (co: ChangeOrder, to: 'accept' | 'reject' | 'cancel') => {
    await changeOrderApi[to](co.id);
    return jobApi.get(co.jobId);
  });
  if (!j) return null;
  const pending = j.changeOrders.find((c) => c.status === 'PENDING');
  const customer = j.viewerRole === 'CUSTOMER';

  return (
    <>
      {pending && customer ? (
        <Card highlight="primary" testID="pending-change-order">
          <Heading>Ek iş onayı bekleniyor</Heading>
          <Body>Ustanız {formatMoney(pending.amount)} tutarında ek iş onayı istedi.</Body>
          <Body muted>“{pending.description}”</Body>
          <InfoRow label="Şu anki toplam" value={formatMoney(pending.previousTotal)} />
          <InfoRow
            label="Onaylarsanız yeni toplam"
            value={formatMoney(pending.proposedTotal)}
            strong
          />
          <Button
            testID="accept-change-order"
            title="Onayla"
            loading={answer.busy}
            onPress={() =>
              confirm(
                'Ek işi onaylıyor musunuz?',
                `Yeni toplam ${formatMoney(pending.proposedTotal)} olacak.`,
                () => void answer.submit(pending, 'accept'),
                { yes: 'Onayla' },
              )
            }
          />
          <Button
            testID="reject-change-order"
            title="Reddet"
            variant="danger"
            disabled={answer.busy}
            onPress={() =>
              confirm(
                'Ek işi reddediyor musunuz?',
                `Toplam ${formatMoney(pending.previousTotal)} olarak kalacak.`,
                () => void answer.submit(pending, 'reject'),
                { yes: 'Reddet', destructive: true },
              )
            }
          />
          <FormError message={answer.error} />
        </Card>
      ) : null}

      {pending && !customer ? (
        <Card highlight="primary">
          <Heading>Ek iş talebiniz müşteride</Heading>
          <Body>
            {formatMoney(pending.amount)} · yeni toplam {formatMoney(pending.proposedTotal)}
          </Body>
          <Small>Müşteri yanıtlayana kadar “İşi Tamamladım” kapalıdır.</Small>
          <Button
            title="Talebi geri çek"
            variant="ghost"
            loading={answer.busy}
            onPress={() =>
              confirm(
                'Ek iş talebini geri çekiyor musunuz?',
                pending.description,
                () => void answer.submit(pending, 'cancel'),
              )
            }
          />
          <FormError message={answer.error} />
        </Card>
      ) : null}

      {j.actions.addChangeOrder ? <ChangeOrderForm job={job} /> : null}

      {j.changeOrders.length > 0 ? (
        <Card>
          <Heading>Ek işler</Heading>
          {j.changeOrders.map((c) => {
            const s = CHANGE_ORDER_STATUS[c.status];
            return (
              <View key={c.id} style={styles.item}>
                <View style={styles.row}>
                  <Body style={styles.amount}>+{formatMoney(c.amount)}</Body>
                  <Badge label={s.label} tone={s.tone} />
                </View>
                <Small>{c.description}</Small>
                <Small>{formatDateTime(c.createdAt)}</Small>
              </View>
            );
          })}
        </Card>
      ) : null}
    </>
  );
}

function ChangeOrderForm({ job }: { job: ApiState<Job> }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const j = job.data;
  const create = useJobAction(job, async (minor: number) => {
    if (!j) return null;
    await changeOrderApi.create(j.id, minor, description.trim());
    setOpen(false);
    setAmount('');
    setDescription('');
    return jobApi.get(j.id);
  });
  if (!j) return null;
  if (!open) {
    return (
      <Button
        testID="open-change-order"
        title="+ Ek iş onayı iste"
        variant="secondary"
        onPress={() => setOpen(true)}
      />
    );
  }
  const onSend = () => {
    const minor = parseTryInput(amount);
    if (minor === null || minor < MIN_PRICE_MINOR) {
      create.setError('Tutarı 500 veya 500,50 biçiminde yazın.');
      return;
    }
    if (description.trim().length < CHANGE_ORDER_DESCRIPTION_MIN_LENGTH) {
      create.setError('Ek işin nedenini en az 10 karakterle açıklayın.');
      return;
    }
    const total = j.currentTotal.amountMinor + minor;
    confirm(
      'Ek iş onayı gönderilsin mi?',
      `${formatMoney(minor)} ek iş. Müşteri onaylarsa yeni toplam ${formatMoney(total)} olacak.`,
      () => void create.submit(minor),
      { yes: 'Gönder' },
    );
  };
  return (
    <Card testID="change-order-form">
      <Heading>Ek iş onayı iste</Heading>
      <Small>Anlaşılan fiyat değişmez. Müşteri onaylarsa tutar güncel toplama eklenir.</Small>
      <TextField
        testID="change-order-amount"
        label="Ek tutar"
        prefix="₺"
        keyboardType="decimal-pad"
        value={amount}
        onChangeText={setAmount}
        placeholder="500"
      />
      <TextField
        testID="change-order-description"
        label="Neden gerekli?"
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={1000}
        placeholder="Örn. kompresör rölesi arızalı çıktı, parça değişecek."
      />
      <FormError message={create.error} />
      <View style={styles.buttons}>
        <Button
          testID="send-change-order"
          title="Onaya gönder"
          loading={create.busy}
          onPress={onSend}
        />
        <Button
          title="Vazgeç"
          variant="ghost"
          disabled={create.busy}
          onPress={() => setOpen(false)}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  item: { gap: 2, paddingVertical: spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  amount: { fontWeight: '700' },
  buttons: { gap: spacing.sm },
});
