import type { ProviderEarning } from '@ustago/types';
import { formatBps } from '@ustago/validation';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { walletApi } from '../../src/api/finance';
import { Badge } from '../../src/components/Badge';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { InfoRow } from '../../src/components/InfoRow';
import { Screen } from '../../src/components/Screen';
import { ErrorState, LoadingState } from '../../src/components/States';
import { Heading, Small } from '../../src/components/Text';
import { useApi } from '../../src/hooks/useApi';
import { earningStatus } from '../../src/lib/finance';
import { formatDateTime, formatMoney } from '../../src/lib/format';

/** One job's earning: gross, platform fee, net and when it becomes available. */
export default function EarningDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const earning = useApi<ProviderEarning>(`earning:${id}`, () => walletApi.earning(id));

  if (earning.loading) return <LoadingState />;
  if (earning.error || !earning.data)
    return <ErrorState message={earning.error ?? 'Kazanç bulunamadı.'} onRetry={earning.refresh} />;
  const e = earning.data;
  const status = earningStatus(e.status);

  return (
    <Screen onRefresh={earning.refresh} refreshing={earning.refreshing}>
      <Card testID="earning-detail">
        <Badge label={status.label} tone={status.tone} />
        <Heading>{e.jobTitle}</Heading>
        <Small>
          {e.categoryName} · {formatDateTime(e.createdAt)}
        </Small>
        <InfoRow label="Brüt" value={formatMoney(e.gross)} />
        <InfoRow
          label={`Platform ücreti (${formatBps(e.feeBps)})`}
          value={`−${formatMoney(e.platformFee)}`}
        />
        {e.refunded.amountMinor > 0 ? (
          <InfoRow label="İade" value={`−${formatMoney(e.refunded)}`} />
        ) : null}
        <InfoRow label="Net kazancınız" value={formatMoney(e.net)} strong />
        {e.status === 'PENDING' || e.status === 'HELD' ? (
          <InfoRow
            label="Kullanılabilir olacağı zaman"
            value={e.holdUntil ? formatDateTime(e.holdUntil) : 'İş onaylandıktan sonra'}
          />
        ) : null}
        {e.releasedAt ? (
          <InfoRow label="Kullanılabilir oldu" value={formatDateTime(e.releasedAt)} />
        ) : null}
        {e.status === 'HELD' ? (
          <Small>Bu kazanç, açık bir sorun bildirimi sonuçlanana kadar bekletiliyor.</Small>
        ) : null}
      </Card>
      <Button title="İşe git" variant="secondary" onPress={() => router.push(`/job/${e.jobId}`)} />
    </Screen>
  );
}
