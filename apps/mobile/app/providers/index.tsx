import type { Paginated, ProviderCard as ProviderCardData, ProviderSort } from '@ustago/types';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { discoveryApi } from '../../src/api/customer-v2';
import { Button } from '../../src/components/Button';
import { Chip } from '../../src/components/Chip';
import { EmptyState, ErrorState, FormError, LoadingState } from '../../src/components/States';
import { Small } from '../../src/components/Text';
import { ProviderCard } from '../../src/features/customer/ProviderCard';
import { SORT_OPTIONS } from '../../src/features/customer/text';
import { useDefaultAddress } from '../../src/features/customer/useDefaultAddress';
import { defaultMapProvider, type MapPin, type PointCluster } from '../../src/features/map';
import { useApi } from '../../src/hooks/useApi';
import { useSubmit } from '../../src/hooks/useSubmit';
import { colors, radii, spacing, typography } from '../../src/lib/theme';

type View_ = 'LIST' | 'MAP';

const RATINGS: { value: number | null; label: string }[] = [
  { value: null, label: 'Tüm puanlar' },
  { value: 4, label: '4+ ⭐' },
  { value: 4.5, label: '4,5+ ⭐' },
];

/**
 * Provider discovery for a category: real ranking from the API
 * (RECOMMENDED by default), filters, cursor pages and a list/map toggle.
 * The map shows approximate district-centre pins only; the list is the
 * accessible alternative and always has the same providers.
 */
export default function ProviderDiscovery() {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ categoryId?: string; categoryName?: string }>();
  const categoryId = params.categoryId ?? '';
  const { address, settled } = useDefaultAddress();
  const districtId = address?.district.id;

  const [sort, setSort] = useState<ProviderSort>('RECOMMENDED');
  const [availableToday, setAvailableToday] = useState(false);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [minRating, setMinRating] = useState<number | null>(null);
  const [view, setView] = useState<View_>('LIST');
  const [selectedCluster, setSelectedCluster] = useState<PointCluster<MapPin> | null>(null);

  useEffect(() => {
    if (params.categoryName) navigation.setOptions({ title: params.categoryName });
  }, [navigation, params.categoryName]);

  const filters = {
    categoryId: categoryId || undefined,
    districtId,
    sort,
    availableToday,
    verifiedOnly,
    minRating: minRating ?? undefined,
  };
  const key = settled ? `providers:${JSON.stringify(filters)}` : '';
  const first = useApi<Paginated<ProviderCardData>>(key, () => discoveryApi.providers(filters));
  const [extra, setExtra] = useState<{
    key: string;
    items: ProviderCardData[];
    cursor: string | null;
  } | null>(null);
  const pages = extra?.key === key ? extra : null;
  const next = pages ? pages.cursor : (first.data?.nextCursor ?? null);
  const items = useMemo(() => {
    const base = first.data?.items ?? [];
    const more = (pages?.items ?? []).filter((p) => !base.some((b) => b.id === p.id));
    return [...base, ...more];
  }, [first.data, pages]);

  const more = useSubmit(async () => {
    if (!next) return;
    const page = await discoveryApi.providers({ ...filters, cursor: next });
    setExtra({ key, items: [...(pages?.items ?? []), ...page.items], cursor: page.nextCursor });
  });

  const openProvider = useCallback((p: ProviderCardData) => router.push(`/usta/${p.id}`), [router]);
  const requestHere = () =>
    router.push({
      pathname: '/request/new',
      params: categoryId ? { type: 'QUOTE', categoryId } : { type: 'QUOTE' },
    });

  const pins: MapPin[] = useMemo(
    () =>
      items.flatMap((p) =>
        p.approxPoint
          ? [{ id: p.id, lat: p.approxPoint.lat, lng: p.approxPoint.lng, label: p.displayName }]
          : [],
      ),
    [items],
  );
  const withoutPoint = items.length - pins.length;
  const clusterProviders = selectedCluster
    ? items.filter((p) => selectedCluster.points.some((pt) => pt.id === p.id))
    : [];
  const MapView = defaultMapProvider.MapView;

  const header = (
    <View style={styles.header}>
      {address ? (
        <Small>
          📍 {address.district.name} / {address.province.name} çevresindeki ustalar
        </Small>
      ) : settled ? (
        <Small>Adres eklersen sana yakın ustaları ve yaklaşık mesafeyi görebilirsin.</Small>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {SORT_OPTIONS.map((o) => (
          <Chip
            key={o.value}
            label={o.label}
            selected={sort === o.value}
            onPress={() => setSort(o.value)}
          />
        ))}
      </ScrollView>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {RATINGS.map((r) => (
          <Chip
            key={r.label}
            label={r.label}
            selected={minRating === r.value}
            onPress={() => setMinRating(r.value)}
          />
        ))}
      </ScrollView>
      <View style={styles.switches}>
        <Toggle
          label="Bugün müsait"
          value={availableToday}
          onChange={setAvailableToday}
          testID="filter-today"
        />
        <Toggle
          label="Doğrulanmış"
          value={verifiedOnly}
          onChange={setVerifiedOnly}
          testID="filter-verified"
        />
      </View>
      <View style={styles.segment} accessibilityRole="tablist">
        {(['LIST', 'MAP'] as const).map((v) => (
          <Chip
            key={v}
            label={v === 'LIST' ? '☰ Liste' : '🗺 Harita'}
            selected={view === v}
            onPress={() => {
              setView(v);
              setSelectedCluster(null);
            }}
          />
        ))}
      </View>
      {view === 'MAP' && items.length > 0 ? (
        <View style={styles.mapWrap}>
          {pins.length > 0 ? (
            <MapView
              pins={pins}
              selectedClusterId={selectedCluster?.id ?? null}
              onPressCluster={setSelectedCluster}
            />
          ) : null}
          {withoutPoint > 0 ? (
            <Small>{withoutPoint} ustanın yaklaşık konumu bilinmiyor; listede görünürler.</Small>
          ) : null}
          <Small>
            {selectedCluster
              ? `Seçilen bölgede ${clusterProviders.length} usta:`
              : 'Bir noktaya dokun, o bölgedeki ustalar aşağıda listelensin.'}
          </Small>
        </View>
      ) : null}
    </View>
  );

  const data = view === 'MAP' ? clusterProviders : items;
  const showList = !first.loading && !first.error;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <FlatList
        data={showList ? data : []}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => <ProviderCard provider={item} onPress={openProvider} />}
        ListHeaderComponent={header}
        contentContainerStyle={styles.content}
        refreshing={first.refreshing}
        onRefresh={() => {
          setExtra(null);
          void first.refresh();
        }}
        initialNumToRender={8}
        windowSize={7}
        ListEmptyComponent={
          !settled || first.loading ? (
            <LoadingState label="Ustalar yükleniyor…" />
          ) : first.error ? (
            <ErrorState message={first.error} onRetry={first.refresh} />
          ) : view === 'MAP' && items.length > 0 ? null : (
            <EmptyState
              icon="🔧"
              title="Bu filtrelere uyan usta bulunamadı"
              body="Filtreleri gevşetebilir ya da talep oluşturabilirsin; talebin bölgendeki uygun ustalara iletilir."
              action={{ title: 'Talep oluştur', onPress: requestHere }}
            />
          )
        }
        ListFooterComponent={
          showList ? (
            <View style={styles.footer}>
              {view === 'LIST' && next ? (
                <Button
                  testID="load-more-providers"
                  title="Daha fazla"
                  variant="secondary"
                  loading={more.busy}
                  onPress={() => void more.submit()}
                />
              ) : null}
              <FormError message={more.error} />
              {items.length > 0 ? (
                <Button title="Bu hizmet için talep oluştur" onPress={requestHere} />
              ) : null}
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

function Toggle({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  testID?: string;
}) {
  return (
    <View style={styles.toggle}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch testID={testID} value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  header: { gap: spacing.sm, marginBottom: spacing.xs },
  chips: { gap: spacing.sm, paddingVertical: 2 },
  switches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: typography.minTouchTarget,
    backgroundColor: colors.background,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  toggleLabel: { fontSize: 15, color: colors.textPrimary, fontWeight: '500' },
  segment: { flexDirection: 'row', gap: spacing.sm },
  mapWrap: { gap: spacing.sm },
  footer: { gap: spacing.sm, marginTop: spacing.sm },
});
