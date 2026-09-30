import type { DisputeReason, Job } from '@ustago/types';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { jobApi } from '../../api/services';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Chip } from '../../components/Chip';
import { FormError } from '../../components/States';
import { Body, Heading, Small } from '../../components/Text';
import { TextField } from '../../components/TextField';
import type { ApiState } from '../../hooks/useApi';
import { confirm } from '../../lib/confirm';
import { DISPUTE_REASONS } from '../../lib/labels';
import { spacing } from '../../lib/theme';
import { useJobAction } from './useJobAction';

/**
 * "Sorun Bildir": a reason category and a description. Before the provider
 * arrives the only choice is "Usta gelmedi"; the server enforces the same.
 */
export function DisputeForm({
  job,
  onClose,
  noShowOnly,
}: {
  job: ApiState<Job>;
  onClose: () => void;
  noShowOnly: boolean;
}) {
  const [reason, setReason] = useState<DisputeReason | null>(noShowOnly ? 'NO_SHOW' : null);
  const [description, setDescription] = useState('');
  const j = job.data;
  const send = useJobAction(job, async () => {
    if (!j || !reason) return null;
    const next = await jobApi.dispute(j.id, reason, description.trim());
    onClose();
    return next;
  });
  const reasons = noShowOnly
    ? DISPUTE_REASONS.filter((r) => r.value === 'NO_SHOW')
    : DISPUTE_REASONS.filter((r) => r.value !== 'NO_SHOW');

  const onSend = () => {
    if (!reason) {
      send.setError('Lütfen bir sorun türü seçin.');
      return;
    }
    if (description.trim().length < 10) {
      send.setError('Sorunu en az 10 karakterle anlatın.');
      return;
    }
    confirm(
      'Sorun bildirilsin mi?',
      'İş “Sorun bildirildi” durumuna geçer ve UstaGO ekibi inceler.',
      () => void send.submit(),
      { yes: 'Bildir', destructive: true },
    );
  };

  return (
    <Card testID="dispute-form" highlight="emergency">
      <Heading>Sorun bildir</Heading>
      <Small>Bildiriminiz UstaGO ekibine iletilir; iş bu sırada tamamlanmış sayılmaz.</Small>
      <View style={styles.chips}>
        {reasons.map((r) => (
          <Chip
            key={r.value}
            label={r.label}
            selected={reason === r.value}
            onPress={() => setReason(r.value)}
          />
        ))}
      </View>
      <TextField
        testID="dispute-description"
        label="Ne oldu?"
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={2000}
        placeholder="Kısaca anlatın."
      />
      <Body muted>Telefon numarası veya adres yazmanıza gerek yok.</Body>
      <FormError message={send.error} />
      <Button
        testID="send-dispute"
        title="Sorunu bildir"
        variant="danger"
        loading={send.busy}
        onPress={onSend}
      />
      <Button title="Vazgeç" variant="ghost" disabled={send.busy} onPress={onClose} />
    </Card>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
