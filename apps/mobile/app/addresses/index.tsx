import type { Address } from '@ustago/types';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { addressApi } from '../../src/api/services';
import { Badge } from '../../src/components/Badge';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Screen } from '../../src/components/Screen';
import { EmptyState, ErrorState, FormError, LoadingState } from '../../src/components/States';
import { Small } from '../../src/components/Text';
import { useApi } from '../../src/hooks/useApi';
import { useSubmit } from '../../src/hooks/useSubmit';
import { confirm } from '../../src/lib/confirm';
import { colors, spacing } from '../../src/lib/theme';

export default function Addresses() {
  const router = useRouter();
  const list = useApi<Address[]>('addresses', addressApi.list);
  const remove = useSubmit(async (id: string) => {
    await addressApi.remove(id);
    await list.refresh();
  });

  return (
    <Screen
      onRefresh={list.refresh}
      refreshing={list.refreshing}
      footer={<Button title="+ Yeni Adres" onPress={() => router.push('/addresses/edit')} />}
    >
      {list.loading ? (
        <LoadingState />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.refresh} />
      ) : list.data?.length === 0 ? (
        <EmptyState
          icon="📍"
          title="Kayıtlı adresiniz yok"
          body="Talep oluştururken kullanmak için bir adres ekleyin."
        />
      ) : (
        list.data?.map((a) => (
          <Card key={a.id}>
            <View style={styles.row}>
              <Text style={styles.title}>{a.label ?? 'Adres'}</Text>
              {a.isDefault ? <Badge label="Varsayılan" tone="info" /> : null}
            </View>
            <Small>
              {a.addressLine}
              {a.neighborhood ? `, ${a.neighborhood}` : ''} · {a.district.name} / {a.province.name}
            </Small>
            <View style={styles.row}>
              <Button
                title="Düzenle"
                variant="ghost"
                onPress={() => router.push({ pathname: '/addresses/edit', params: { id: a.id } })}
              />
              <Button
                title="Sil"
                variant="ghost"
                onPress={() =>
                  confirm(
                    'Adresi sil',
                    'Bu adres listenizden kaldırılacak.',
                    () => void remove.submit(a.id),
                    { yes: 'Sil', destructive: true },
                  )
                }
              />
            </View>
          </Card>
        ))
      )}
      <FormError message={remove.error} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
});
