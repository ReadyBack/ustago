import type { AccountDeletionRequestView, DataExportRequestView } from '@ustago/types';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ApiError } from '../src/api/client';
import { accountApi } from '../src/api/services';
import { Badge } from '../src/components/Badge';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Screen } from '../src/components/Screen';
import { ErrorState, FormError, LoadingState } from '../src/components/States';
import { TextField } from '../src/components/TextField';
import { Body, Heading, Small } from '../src/components/Text';
import { useApi } from '../src/hooks/useApi';
import { useSubmit } from '../src/hooks/useSubmit';
import {
  ACCOUNT_DELETION_PHRASE,
  blockerLabel,
  blockersFromError,
  DATA_EXPORT_STATUS,
  DELETION_STATUS,
  deletionCancellable,
  deletionOpen,
  hasOpenExport,
  isDeletionConfirmation,
} from '../src/lib/account';
import { confirm } from '../src/lib/confirm';
import { formatDateTime } from '../src/lib/format';
import { colors, radii, spacing } from '../src/lib/theme';

/** Account deletion request (with its grace period and blockers) and the data export request. */
export default function AccountDeletion() {
  const deletion = useApi<AccountDeletionRequestView | null>(
    'me:account-deletion',
    accountApi.deletion,
  );
  if (deletion.loading) return <LoadingState />;
  if (deletion.error) return <ErrorState message={deletion.error} onRetry={deletion.refresh} />;
  return (
    <Screen onRefresh={() => void deletion.refresh()} refreshing={deletion.refreshing}>
      <DataExportCard />
      {deletionOpen(deletion.data) && deletion.data ? (
        <OpenRequest view={deletion.data} onChange={deletion.setData} />
      ) : (
        <RequestForm
          previous={deletion.data}
          onRequested={deletion.setData}
          onConflict={deletion.refresh}
        />
      )}
    </Screen>
  );
}

function DataExportCard() {
  const exports = useApi<DataExportRequestView[]>('me:data-exports', accountApi.dataExports);
  const request = useSubmit(async () => {
    await accountApi.requestDataExport();
    await exports.refresh();
  });
  const list = exports.data ?? [];
  const latest = list[0];
  return (
    <Card>
      <Heading>Verilerimin kopyası</Heading>
      <Body muted>
        Hesabınızla ilgili kişisel verilerinizin bir kopyasını isteyebilirsiniz. Şimdilik bu düğme
        yalnızca talebinizi kaydeder; arşiv otomatik hazırlanmıyor, ekibimiz talebinizi elle işleyip
        sizinle iletişime geçer.
      </Body>
      {latest ? (
        <View style={styles.row}>
          <Small>Son talep: {formatDateTime(latest.requestedAt)}</Small>
          <Badge
            label={DATA_EXPORT_STATUS[latest.status].label}
            tone={DATA_EXPORT_STATUS[latest.status].tone}
          />
        </View>
      ) : null}
      <Button
        testID="request-data-export"
        title={hasOpenExport(list) ? 'Talebiniz kaydedildi' : 'Veri kopyası talep et'}
        variant="secondary"
        loading={request.busy}
        disabled={exports.loading || hasOpenExport(list)}
        onPress={() => void request.submit()}
      />
      <FormError message={request.error ?? exports.error} />
    </Card>
  );
}

function Blockers({ codes }: { codes: string[] }) {
  if (codes.length === 0) return null;
  return (
    <View style={styles.blockers} testID="deletion-blockers">
      <Text style={styles.blockersTitle}>Silme şu an işlenemiyor</Text>
      {codes.map((c) => (
        <Body key={c}>• {blockerLabel(c)}</Body>
      ))}
      <Small>Bunlar kapandığında talebiniz kendiliğinden işleme alınır.</Small>
    </View>
  );
}

function OpenRequest({
  view,
  onChange,
}: {
  view: AccountDeletionRequestView;
  onChange: (v: AccountDeletionRequestView) => void;
}) {
  const status = DELETION_STATUS[view.status];
  const cancel = useSubmit(async () => {
    onChange(await accountApi.cancelDeletion());
  });
  return (
    <Card highlight="emergency">
      <View style={styles.row}>
        <Heading>Hesap silme talebi</Heading>
        <Badge label={status.label} tone={status.tone} />
      </View>
      <Small>Talep tarihi: {formatDateTime(view.requestedAt)}</Small>
      {view.scheduledFor ? (
        <Body>
          Bekleme süresi {formatDateTime(view.scheduledFor)} tarihinde biter. O zamana kadar
          vazgeçebilirsiniz; süre dolunca açık işlem yoksa hesabınız silinir.
        </Body>
      ) : null}
      <Blockers codes={view.blockers} />
      {deletionCancellable(view) ? (
        <Button
          testID="cancel-deletion"
          title="Silme talebini iptal et"
          variant="secondary"
          loading={cancel.busy}
          onPress={() => void cancel.submit()}
        />
      ) : (
        <Small>Talebiniz işleniyor; bu aşamada iptal edilemez.</Small>
      )}
      <FormError message={cancel.error} />
    </Card>
  );
}

function RequestForm({
  previous,
  onRequested,
  onConflict,
}: {
  previous: AccountDeletionRequestView | null;
  onRequested: (v: AccountDeletionRequestView) => void;
  onConflict: () => Promise<void>;
}) {
  const [typed, setTyped] = useState('');
  const [blockers, setBlockers] = useState<string[]>([]);
  const ready = isDeletionConfirmation(typed);
  const request = useSubmit(async () => {
    setBlockers([]);
    try {
      onRequested(await accountApi.requestDeletion());
    } catch (e) {
      setBlockers(blockersFromError(e));
      if (e instanceof ApiError && e.status === 409) await onConflict();
      throw e;
    }
  });
  return (
    <Card>
      <Heading>Hesabımı sil</Heading>
      {previous?.status === 'CANCELLED' ? (
        <Small>Önceki silme talebinizi iptal etmiştiniz.</Small>
      ) : null}
      <Body>Hesabınızı silmek istediğinizde:</Body>
      <Body muted>• Talebiniz bir bekleme süresi boyunca bekler; bu sürede vazgeçebilirsiniz.</Body>
      <Body muted>
        • Devam eden iş, açık sorun bildirimi veya sonuçlanmamış para çekme talebi varsa silme
        bunlar kapanana kadar bekler.
      </Body>
      <Body muted>
        • Süre dolunca adınız, telefonunuz ve e-postanız silinir. Ödeme ve iş kayıtları kimliğinizle
        ilişkilendirilmeden saklanır.
      </Body>
      <TextField
        testID="deletion-confirm-input"
        label={`Onaylamak için ${ACCOUNT_DELETION_PHRASE} yazın`}
        value={typed}
        onChangeText={setTyped}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder={ACCOUNT_DELETION_PHRASE}
      />
      <Blockers codes={blockers} />
      <FormError message={request.error} />
      <Button
        testID="request-deletion"
        title="Hesabımı silme talebi oluştur"
        variant="danger"
        disabled={!ready}
        loading={request.busy}
        onPress={() =>
          confirm(
            'Hesabınız silinsin mi?',
            'Bekleme süresi dolana kadar talebinizi iptal edebilirsiniz.',
            () => void request.submit(),
            { yes: 'Silme talebi oluştur', destructive: true },
          )
        }
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  blockers: {
    backgroundColor: colors.emergencySoft,
    borderRadius: radii.sm,
    padding: spacing.sm,
    gap: 2,
  },
  blockersTitle: { fontWeight: '700', color: colors.emergency },
});
