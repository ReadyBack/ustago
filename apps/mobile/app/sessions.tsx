import type { ActiveSession } from '@ustago/types';
import { StyleSheet, Text, View } from 'react-native';

import { sessionApi } from '../src/api/services';
import { Badge } from '../src/components/Badge';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Screen } from '../src/components/Screen';
import { EmptyState, ErrorState, FormError, LoadingState } from '../src/components/States';
import { Body, Small } from '../src/components/Text';
import { useApi } from '../src/hooks/useApi';
import { useSubmit } from '../src/hooks/useSubmit';
import { sessionTitle, sortSessions } from '../src/lib/account';
import { confirm } from '../src/lib/confirm';
import { formatDateTime, timeAgo } from '../src/lib/format';
import { colors, spacing } from '../src/lib/theme';

/** "Aktif Oturumlar": every signed-in device, this one marked; others can be signed out. */
export default function Sessions() {
  const list = useApi<ActiveSession[]>('me:sessions', sessionApi.list);

  const revoke = useSubmit(async (ids: string[]) => {
    for (const id of ids) await sessionApi.revoke(id);
    await list.refresh();
  });

  if (list.loading) return <LoadingState />;
  if (list.error || !list.data) {
    return <ErrorState message={list.error ?? 'Oturumlar yüklenemedi.'} onRetry={list.refresh} />;
  }
  const sessions = sortSessions(list.data);
  const others = sessions.filter((s) => !s.current);

  return (
    <Screen onRefresh={() => void list.refresh()} refreshing={list.refreshing}>
      <Body muted>
        Hesabınıza giriş yapılmış cihazlar. Tanımadığınız bir cihaz görürseniz oturumunu kapatın. IP
        adresiniz saklanmaz; giriş zamanı yaklaşık gösterilir.
      </Body>
      {sessions.length === 0 ? (
        <EmptyState icon="📱" title="Açık oturum yok" />
      ) : (
        sessions.map((s) => (
          <Card key={s.id} testID={`session-${s.id}`} highlight={s.current ? 'primary' : undefined}>
            <View style={styles.row}>
              <Text style={styles.title}>{sessionTitle(s)}</Text>
              {s.current ? <Badge label="Bu cihaz" tone="info" /> : null}
            </View>
            {s.userAgentSummary && s.deviceName ? <Small>{s.userAgentSummary}</Small> : null}
            <Small>Son kullanım: {timeAgo(s.lastUsedAt)}</Small>
            <Small>Giriş: yaklaşık {formatDateTime(s.createdApprox)}</Small>
            {!s.current ? (
              <Button
                title="Oturumu kapat"
                variant="danger"
                loading={revoke.busy}
                onPress={() =>
                  confirm(
                    'Oturumu kapat',
                    `${sessionTitle(s)} cihazındaki oturum kapatılacak; tekrar giriş yapması gerekir.`,
                    () => void revoke.submit([s.id]),
                    { yes: 'Kapat', destructive: true },
                  )
                }
              />
            ) : null}
          </Card>
        ))
      )}
      {others.length > 1 ? (
        <Button
          testID="revoke-others"
          title="Diğer tüm oturumları kapat"
          variant="danger"
          loading={revoke.busy}
          onPress={() =>
            confirm(
              'Diğer oturumları kapat',
              `Bu cihaz dışındaki ${others.length} oturum kapatılacak.`,
              () => void revoke.submit(others.map((s) => s.id)),
              { yes: 'Hepsini kapat', destructive: true },
            )
          }
        />
      ) : null}
      <FormError message={revoke.error} />
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
  title: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.textPrimary },
});
