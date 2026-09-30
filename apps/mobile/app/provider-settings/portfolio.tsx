import type { PortfolioItem, ProviderServiceItem } from '@ustago/types';
import { MAX_PORTFOLIO_ITEMS } from '@ustago/validation';
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { providerV2Api } from '../../src/api/provider-v2';
import { providerApi } from '../../src/api/services';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Screen } from '../../src/components/Screen';
import { EmptyState, ErrorState, FormError, LoadingState } from '../../src/components/States';
import { Small } from '../../src/components/Text';
import { moveId } from '../../src/features/provider/portfolio';
import { PortfolioForm } from '../../src/features/provider/PortfolioForm';
import { useApi } from '../../src/hooks/useApi';
import { useSubmit } from '../../src/hooks/useSubmit';
import { api } from '../../src/api/session';
import { confirm } from '../../src/lib/confirm';
import { colors, radii, spacing } from '../../src/lib/theme';

/** Portföy: list, add, edit, delete and reorder the provider's work photos. */
export default function PortfolioSettings() {
  const portfolio = useApi<PortfolioItem[]>('provider:portfolio', providerV2Api.portfolio);
  const services = useApi<ProviderServiceItem[]>('provider:services', providerApi.services);
  const [form, setForm] = useState<'new' | PortfolioItem | null>(null);

  const reorder = useSubmit(async (ids: string[]) => {
    portfolio.setData(await providerV2Api.reorderPortfolio(ids));
  });
  const remove = useSubmit(async (id: string) => {
    await providerV2Api.deletePortfolioItem(id);
    await portfolio.refresh();
  });

  if (portfolio.loading) return <LoadingState />;
  if (portfolio.error || !portfolio.data) {
    return (
      <ErrorState message={portfolio.error ?? 'Portföy yüklenemedi.'} onRetry={portfolio.refresh} />
    );
  }
  const items = [...portfolio.data].sort((a, b) => a.sortOrder - b.sortOrder);
  const ids = items.map((i) => i.id);
  const full = items.length >= MAX_PORTFOLIO_ITEMS;

  return (
    <Screen onRefresh={portfolio.refresh} refreshing={portfolio.refreshing}>
      <Small>
        Yaptığın işlerin fotoğrafları profilinde görünür. {items.length}/{MAX_PORTFOLIO_ITEMS}{' '}
        çalışma; her çalışmada en fazla 6 fotoğraf.
      </Small>

      {form ? (
        <PortfolioForm
          services={services.data ?? []}
          editing={form === 'new' ? null : form}
          onCancel={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            void portfolio.refresh();
          }}
        />
      ) : (
        <Button
          testID="portfolio-new"
          title="+ Yeni çalışma ekle"
          disabled={full}
          accessibilityHint={
            full ? `En fazla ${MAX_PORTFOLIO_ITEMS} çalışma eklenebilir` : undefined
          }
          onPress={() => setForm('new')}
        />
      )}
      <FormError message={reorder.error ?? remove.error} />

      {items.length === 0 && !form ? (
        <EmptyState
          icon="🖼️"
          title="Portföyün boş"
          body="Yaptığın işlerden fotoğraf ekleyerek müşterilerin seni tanımasına yardımcı olabilirsin."
        />
      ) : null}

      {items.map((item, index) => {
        const cover = item.media[0];
        return (
          <Card key={item.id} testID={`portfolio-${item.id}`}>
            <View style={styles.row}>
              {cover ? (
                <Image
                  source={{ uri: api.reachable(cover.url) }}
                  style={styles.cover}
                  accessible
                  accessibilityLabel={`${item.title} kapak fotoğrafı`}
                />
              ) : null}
              <View style={styles.flex}>
                <Text style={styles.title}>
                  {index + 1}. {item.title}
                </Text>
                <Small>
                  {item.category?.name ?? 'Kategorisiz'} · {item.media.length} fotoğraf
                </Small>
                {item.description ? <Small>{item.description}</Small> : null}
              </View>
            </View>
            <View style={styles.actions}>
              <Button
                title="↑ Yukarı"
                variant="ghost"
                accessibilityLabel={`${item.title} yukarı taşı`}
                disabled={index === 0 || reorder.busy}
                onPress={() => void reorder.submit(moveId(ids, item.id, -1))}
              />
              <Button
                title="↓ Aşağı"
                variant="ghost"
                accessibilityLabel={`${item.title} aşağı taşı`}
                disabled={index === items.length - 1 || reorder.busy}
                onPress={() => void reorder.submit(moveId(ids, item.id, 1))}
              />
              <Button
                title="Düzenle"
                variant="ghost"
                accessibilityLabel={`${item.title} düzenle`}
                onPress={() => setForm(item)}
              />
              <Button
                title="Sil"
                variant="ghost"
                accessibilityLabel={`${item.title} sil`}
                onPress={() =>
                  confirm(
                    'Çalışmayı sil',
                    `“${item.title}” ve fotoğrafları portföyünden kaldırılacak.`,
                    () => void remove.submit(item.id),
                    { yes: 'Sil', destructive: true },
                  )
                }
              />
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1, gap: 2 },
  cover: { width: 72, height: 72, borderRadius: radii.sm, backgroundColor: colors.surface },
  title: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
