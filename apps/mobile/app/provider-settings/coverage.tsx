import type { District, ProviderCoverage, ProviderServiceRegion, Province } from '@ustago/types';
import {
  MAX_SERVICE_REGIONS,
  type SetProviderRegions,
  setProviderRegionsSchema,
  TRAVEL_DISTANCE_PRESETS_KM,
} from '@ustago/validation';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ApiError } from '../../src/api/client';
import { providerV2Api } from '../../src/api/provider-v2';
import { catalogApi } from '../../src/api/services';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Chip } from '../../src/components/Chip';
import { Screen } from '../../src/components/Screen';
import { SelectField } from '../../src/components/SelectField';
import { ErrorState, FormError, LoadingState } from '../../src/components/States';
import { Heading, Small } from '../../src/components/Text';
import { useApi } from '../../src/hooks/useApi';
import { useSubmit } from '../../src/hooks/useSubmit';
import { confirm } from '../../src/lib/confirm';
import { colors, spacing } from '../../src/lib/theme';

type RegionInput = SetProviderRegions['regions'][number];

const toInput = (r: ProviderServiceRegion): RegionInput | null =>
  r.kind === 'PROVINCE'
    ? { kind: 'PROVINCE', provinceId: r.province.id }
    : r.centerDistrict && r.radiusKm
      ? { kind: 'RADIUS', centerDistrictId: r.centerDistrict.id, radiusKm: r.radiusKm }
      : null;

const regionLabel = (r: ProviderServiceRegion): string =>
  r.kind === 'PROVINCE'
    ? `${r.province.name} (tüm il)`
    : `${r.centerDistrict?.name ?? '—'} / ${r.province.name} merkezli ${r.radiusKm ?? '—'} km`;

function useDistricts(provinceId: number | null) {
  return useApi<District[]>(
    provinceId ? `districts:${provinceId}` : '',
    () => (provinceId ? catalogApi.districts(provinceId) : Promise.resolve([])),
    { enabled: provinceId !== null },
  );
}

/** Hizmet bölgeleri: districts, whole provinces, radius regions, travel limit, service centre. */
export default function CoverageSettings() {
  const coverage = useApi<ProviderCoverage>('provider:coverage', providerV2Api.coverage);
  const provinces = useApi<Province[]>('provinces:active', catalogApi.provinces);

  if (coverage.loading || provinces.loading) return <LoadingState />;
  if (coverage.error || !coverage.data) {
    return (
      <ErrorState
        message={coverage.error ?? 'Hizmet bölgeleri yüklenemedi.'}
        onRetry={coverage.refresh}
      />
    );
  }
  const c = coverage.data;
  const list = provinces.data ?? [];
  return (
    <Screen onRefresh={coverage.refresh} refreshing={coverage.refreshing}>
      <DistrictsCard coverage={c} provinces={list} onSaved={coverage.refresh} />
      <RegionsCard coverage={c} provinces={list} onChange={coverage.setData} />
      <TravelCard coverage={c} onChange={coverage.setData} />
      <ServiceCenterCard coverage={c} provinces={list} onChange={coverage.setData} />
    </Screen>
  );
}

function DistrictsCard({
  coverage,
  provinces,
  onSaved,
}: {
  coverage: ProviderCoverage;
  provinces: Province[];
  onSaved: () => Promise<void>;
}) {
  const [groups, setGroups] = useState(
    () =>
      Object.fromEntries(
        coverage.districts.map((g) => [g.province.id, g.districts.map((d) => d.id)]),
      ) as Record<number, string[]>,
  );
  const [provinceId, setProvinceId] = useState<number | null>(
    coverage.districts[0]?.province.id ?? null,
  );
  const districts = useDistricts(provinceId);
  const selected = provinceId ? (groups[provinceId] ?? []) : [];
  const save = useSubmit(async () => {
    const areas = Object.entries(groups)
      .map(([id, districtIds]) => ({ provinceId: Number(id), districtIds }))
      .filter((a) => a.districtIds.length > 0);
    await providerV2Api.setServiceAreas(areas);
    await onSaved();
  });
  const toggle = (id: string) => {
    if (!provinceId) return;
    setGroups((g) => {
      const cur = g[provinceId] ?? [];
      return { ...g, [provinceId]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
    });
  };

  return (
    <Card>
      <Heading>İlçeler</Heading>
      {coverage.districts.length === 0 ? (
        <Small>Henüz ilçe seçmedin.</Small>
      ) : (
        coverage.districts.map((g) => (
          <Small key={g.province.id}>
            {g.province.name}: {g.districts.map((d) => d.name).join(', ')}
          </Small>
        ))
      )}
      <SelectField
        label="İl"
        placeholder="İl seçin"
        options={provinces.map((p) => ({ value: p.id, label: p.name }))}
        value={provinceId}
        onChange={setProvinceId}
      />
      {provinceId ? (
        districts.loading ? (
          <LoadingState />
        ) : (
          <View style={styles.chips}>
            {(districts.data ?? []).map((d) => (
              <Chip
                key={d.id}
                label={d.name}
                selected={selected.includes(d.id)}
                onPress={() => toggle(d.id)}
              />
            ))}
          </View>
        )
      ) : null}
      <FormError message={save.error} />
      <Button
        title="İlçeleri kaydet"
        variant="secondary"
        loading={save.busy}
        onPress={() => void save.submit()}
      />
    </Card>
  );
}

function RegionsCard({
  coverage,
  provinces,
  onChange,
}: {
  coverage: ProviderCoverage;
  provinces: Province[];
  onChange: (c: ProviderCoverage) => void;
}) {
  const [mode, setMode] = useState<'PROVINCE' | 'RADIUS'>('PROVINCE');
  const [provinceId, setProvinceId] = useState<number | null>(null);
  const [districtId, setDistrictId] = useState<string | null>(null);
  const [radiusKm, setRadiusKm] = useState<number>(TRAVEL_DISTANCE_PRESETS_KM[2]);
  const districts = useDistricts(mode === 'RADIUS' ? provinceId : null);
  const current = coverage.regions.map(toInput).filter((r): r is RegionInput => r !== null);

  const put = useSubmit(async (regions: RegionInput[]) => {
    const parsed = setProviderRegionsSchema.safeParse({ regions });
    if (!parsed.success) {
      throw new ApiError(
        400,
        'INVALID_REGIONS',
        parsed.error.issues[0]?.message ?? 'Bölgeleri kontrol edin.',
      );
    }
    onChange(await providerV2Api.setRegions(parsed.data));
    setProvinceId(null);
    setDistrictId(null);
  });

  const add = () => {
    if (mode === 'PROVINCE') {
      if (!provinceId) return;
      void put.submit([...current, { kind: 'PROVINCE', provinceId }]);
    } else {
      if (!districtId) return;
      void put.submit([...current, { kind: 'RADIUS', centerDistrictId: districtId, radiusKm }]);
    }
  };

  return (
    <Card>
      <Heading>Geniş bölgeler</Heading>
      <Small>
        Tüm bir ile ya da bir ilçe merkezinden belirli bir yarıçapa hizmet verebilirsin. Mesafeler
        ilçe merkezleri arasındaki kuş uçuşu yaklaşık mesafedir.
      </Small>
      {coverage.regions.length === 0 ? <Small>Geniş bölge eklemedin.</Small> : null}
      {coverage.regions.map((r, i) => (
        <View key={r.id} style={styles.regionRow}>
          <Text style={styles.regionText}>{regionLabel(r)}</Text>
          <Button
            title="Kaldır"
            variant="ghost"
            accessibilityLabel={`${regionLabel(r)} bölgesini kaldır`}
            loading={put.busy}
            onPress={() =>
              confirm(
                'Bölgeyi kaldır',
                regionLabel(r),
                () => void put.submit(current.filter((_, j) => j !== i)),
                { yes: 'Kaldır', destructive: true },
              )
            }
          />
        </View>
      ))}
      {coverage.regions.length < MAX_SERVICE_REGIONS ? (
        <>
          <View style={styles.chips} accessibilityRole="radiogroup">
            <Chip
              label="Tüm il"
              selected={mode === 'PROVINCE'}
              onPress={() => setMode('PROVINCE')}
            />
            <Chip
              label="Merkez ilçe + yarıçap"
              selected={mode === 'RADIUS'}
              onPress={() => setMode('RADIUS')}
            />
          </View>
          <SelectField
            label="İl"
            placeholder="İl seçin"
            options={provinces.map((p) => ({ value: p.id, label: p.name }))}
            value={provinceId}
            onChange={(v) => {
              setProvinceId(v);
              setDistrictId(null);
            }}
          />
          {mode === 'RADIUS' && provinceId ? (
            <>
              <SelectField
                label="Merkez ilçe"
                placeholder="İlçe seçin"
                options={(districts.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
                value={districtId}
                onChange={setDistrictId}
                disabled={districts.loading}
              />
              <Text style={styles.label}>Yarıçap</Text>
              <View style={styles.chips}>
                {TRAVEL_DISTANCE_PRESETS_KM.map((km) => (
                  <Chip
                    key={km}
                    label={`${km} km`}
                    selected={radiusKm === km}
                    onPress={() => setRadiusKm(km)}
                  />
                ))}
              </View>
            </>
          ) : null}
          <FormError message={put.error} />
          <Button
            testID="add-region"
            title="Bölge ekle"
            variant="secondary"
            loading={put.busy}
            disabled={mode === 'PROVINCE' ? !provinceId : !districtId}
            onPress={add}
          />
        </>
      ) : (
        <Small>En fazla {MAX_SERVICE_REGIONS} geniş bölge eklenebilir.</Small>
      )}
    </Card>
  );
}

function TravelCard({
  coverage,
  onChange,
}: {
  coverage: ProviderCoverage;
  onChange: (c: ProviderCoverage) => void;
}) {
  const save = useSubmit(async (maxTravelKm: number | null) => {
    onChange(await providerV2Api.updateCoverage({ maxTravelKm }));
  });
  return (
    <Card>
      <Heading>En fazla gideceğin mesafe</Heading>
      <Small>
        Hizmet merkezinden kuş uçuşu yaklaşık mesafe. Seçmezsen yalnızca bölgelerin sınırlar.
      </Small>
      <View style={styles.chips}>
        <Chip
          label="Sınır yok"
          selected={coverage.maxTravelKm === null}
          onPress={() => void save.submit(null)}
        />
        {TRAVEL_DISTANCE_PRESETS_KM.map((km) => (
          <Chip
            key={km}
            label={`${km} km`}
            selected={coverage.maxTravelKm === km}
            onPress={() => void save.submit(km)}
          />
        ))}
      </View>
      <FormError message={save.error} />
    </Card>
  );
}

function ServiceCenterCard({
  coverage,
  provinces,
  onChange,
}: {
  coverage: ProviderCoverage;
  provinces: Province[];
  onChange: (c: ProviderCoverage) => void;
}) {
  const [provinceId, setProvinceId] = useState<number | null>(
    coverage.serviceCenter?.province.id ?? null,
  );
  const [districtId, setDistrictId] = useState<string | null>(
    coverage.serviceCenter?.district.id ?? null,
  );
  const districts = useDistricts(provinceId);
  const save = useSubmit(async () => {
    if (!districtId) return;
    onChange(await providerV2Api.updateCoverage({ serviceCenterDistrictId: districtId }));
  });
  return (
    <Card>
      <Heading>Hizmet merkezi</Heading>
      <Small>Hizmet merkezi (ev adresin değil; mesafeler buradan yaklaşık hesaplanır)</Small>
      {coverage.serviceCenter ? (
        <Small>
          Şu an: {coverage.serviceCenter.district.name} / {coverage.serviceCenter.province.name}
        </Small>
      ) : null}
      <SelectField
        label="İl"
        placeholder="İl seçin"
        options={provinces.map((p) => ({ value: p.id, label: p.name }))}
        value={provinceId}
        onChange={(v) => {
          setProvinceId(v);
          setDistrictId(null);
        }}
      />
      {provinceId ? (
        <SelectField
          label="İlçe"
          placeholder="İlçe seçin"
          options={(districts.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
          value={districtId}
          onChange={setDistrictId}
          disabled={districts.loading}
        />
      ) : null}
      <FormError message={save.error} />
      <Button
        testID="save-service-center"
        title="Hizmet merkezini kaydet"
        variant="secondary"
        loading={save.busy}
        disabled={!districtId || districtId === coverage.serviceCenter?.district.id}
        onPress={() => void save.submit()}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  regionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  regionText: { flex: 1, fontSize: 15, color: colors.textPrimary },
  label: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
});
