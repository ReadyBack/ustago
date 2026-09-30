import type { Job } from '@ustago/types';
import { useLocalSearchParams } from 'expo-router';
import { Linking, StyleSheet } from 'react-native';

import { jobApi } from '../../src/api/services';
import { Badge } from '../../src/components/Badge';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { InfoRow } from '../../src/components/InfoRow';
import { Screen } from '../../src/components/Screen';
import { ErrorState, LoadingState } from '../../src/components/States';
import { Body, Heading, Small } from '../../src/components/Text';
import { useApi } from '../../src/hooks/useApi';
import { categoryIcon } from '../../src/lib/categories';
import { formatDateTime, formatMoney, formatPhone } from '../../src/lib/format';
import { JOB_STATUS } from '../../src/lib/labels';
import { colors } from '../../src/lib/theme';

export default function JobDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const job = useApi<Job>(`job:${id}`, () => jobApi.get(id));

  if (job.loading) return <LoadingState />;
  if (job.error || !job.data)
    return <ErrorState message={job.error ?? 'İş bulunamadı.'} onRetry={job.refresh} />;
  const j = job.data;
  const status = JOB_STATUS[j.status];
  const other =
    j.viewerRole === 'CUSTOMER'
      ? { title: 'Usta', name: j.provider.displayName, phone: j.provider.phone }
      : { title: 'Müşteri', name: j.customer.name, phone: j.customer.phone };
  const a = j.address;

  return (
    <Screen onRefresh={job.refresh} refreshing={job.refreshing}>
      <Card highlight="success">
        <Badge
          label={j.serviceRequest.type === 'NOW' ? `🚨 ACİL İŞ · ${status.label}` : status.label}
          tone={status.tone}
        />
        <Heading>{j.serviceRequest.title}</Heading>
        <Small>
          {categoryIcon(j.category.slug)} {j.category.name} · {formatDateTime(j.createdAt)}
        </Small>
        <InfoRow label="Anlaşılan fiyat" value={formatMoney(j.agreedPrice)} strong />
        {j.scheduledStartAt ? (
          <InfoRow label="Başlangıç" value={formatDateTime(j.scheduledStartAt)} />
        ) : null}
      </Card>

      <Card>
        <Heading>{other.title}</Heading>
        <Body>{other.name}</Body>
        <InfoRow label="Telefon" value={formatPhone(other.phone)} />
        {other.phone ? (
          <Button
            title={`📞 ${other.title} ile iletişime geç`}
            variant="secondary"
            onPress={() => void Linking.openURL(`tel:${other.phone}`)}
          />
        ) : null}
      </Card>

      <Card>
        <Heading>Adres</Heading>
        <Body>
          {a.addressLine}
          {a.buildingNo ? `, No: ${a.buildingNo}` : ''}
          {a.apartmentNo ? `, Daire: ${a.apartmentNo}` : ''}
        </Body>
        <Small>
          {a.neighborhood ? `${a.neighborhood}, ` : ''}
          {a.district.name} / {a.province.name}
        </Small>
        {a.instructions ? <Small>Tarif: {a.instructions}</Small> : null}
      </Card>

      <Card style={styles.note}>
        <Body muted>
          Fiyat anlaşma anında kilitlendi ve değiştirilemez. Ödeme ve iş adımlarının (yola çıktım,
          başladım, tamamlandı) takibi sonraki sürümde eklenecek.
        </Body>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { backgroundColor: colors.surface },
});
