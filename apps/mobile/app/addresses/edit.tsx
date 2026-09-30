import type { Address, District, Province } from '@ustago/types';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { ApiError } from '../../src/api/client';
import { addressApi, catalogApi } from '../../src/api/services';
import { BrandIcon } from '../../src/components/Brand';
import { Button } from '../../src/components/Button';
import { Screen } from '../../src/components/Screen';
import { ErrorState, FormError, LoadingState } from '../../src/components/States';
import { SelectField } from '../../src/components/SelectField';
import { TextField } from '../../src/components/TextField';
import { Small } from '../../src/components/Text';
import { useApi } from '../../src/hooks/useApi';
import { useSubmit } from '../../src/hooks/useSubmit';
import { matchByName } from '../../src/lib/location-match';
import { colors, spacing } from '../../src/lib/theme';

export default function EditAddress() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const provinces = useApi<Province[]>('provinces:active', catalogApi.provinces);
  const existing = useApi<Address | null>(`address:${id ?? 'new'}`, () =>
    id ? addressApi.get(id) : Promise.resolve(null),
  );
  if (provinces.loading || existing.loading) return <LoadingState />;
  if (provinces.error || existing.error) {
    return (
      <ErrorState
        message={provinces.error ?? existing.error ?? ''}
        onRetry={() => void Promise.all([provinces.refresh(), existing.refresh()])}
      />
    );
  }
  return <AddressForm id={id} initial={existing.data} provinces={provinces.data ?? []} />;
}

function AddressForm({
  id,
  initial,
  provinces,
}: {
  id: string | undefined;
  initial: Address | null;
  provinces: Province[];
}) {
  const router = useRouter();
  const [label, setLabel] = useState(initial ? (initial.label ?? '') : 'Ev');
  const [provinceId, setProvinceId] = useState<number | null>(initial?.province.id ?? null);
  const [districtId, setDistrictId] = useState<string | null>(initial?.district.id ?? null);
  const [neighborhood, setNeighborhood] = useState(initial?.neighborhood ?? '');
  const [addressLine, setAddressLine] = useState(initial?.addressLine ?? '');
  const [buildingNo, setBuildingNo] = useState(initial?.buildingNo ?? '');
  const [apartmentNo, setApartmentNo] = useState(initial?.apartmentNo ?? '');
  const [instructions, setInstructions] = useState(initial?.instructions ?? '');
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(
    initial && initial.latitude !== null && initial.longitude !== null
      ? { latitude: initial.latitude, longitude: initial.longitude }
      : null,
  );
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false);
  const [locationNote, setLocationNote] = useState<string | null>(null);

  const districts = useApi<District[]>(
    provinceId ? `districts:${provinceId}` : '',
    () => (provinceId ? catalogApi.districts(provinceId) : Promise.resolve([])),
    { enabled: provinceId !== null },
  );

  /** Asks for location permission only now, when the user taps the button. */
  const locate = useSubmit(async () => {
    setLocationNote(null);
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') {
      throw new ApiError(0, 'LOCATION_DENIED', 'Konum izni verilmedi. Adresi elle seçebilirsiniz.');
    }
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const point = { latitude: position.coords.latitude, longitude: position.coords.longitude };
    setCoords(point);
    const [place] = await Location.reverseGeocodeAsync(point).catch(() => []);
    const province = place
      ? matchByName(provinces, [place.region, place.city, place.subregion])
      : null;
    if (!province) {
      setLocationNote(
        'Konum kaydedildi. İl bu bölgede henüz hizmet vermiyor olabilir; il ve ilçeyi listeden seçin.',
      );
      return;
    }
    setProvinceId(province.id);
    setDistrictId(null);
    const list = await catalogApi.districts(province.id);
    const district = place
      ? matchByName(list, [place.subregion, place.district, place.city])
      : null;
    if (district) setDistrictId(district.id);
    if (place?.street && !addressLine)
      setAddressLine([place.street, place.streetNumber].filter(Boolean).join(' No: '));
    if (place?.district && !neighborhood) setNeighborhood(place.district);
    setLocationNote(
      district
        ? 'Konumunuza göre il ve ilçe seçildi; lütfen kontrol edin.'
        : 'İl seçildi; ilçeyi listeden seçin.',
    );
  });

  const save = useSubmit(async () => {
    if (!provinceId || !districtId) throw new ApiError(400, 'INVALID', 'Lütfen il ve ilçe seçin.');
    if (addressLine.trim().length < 5)
      throw new ApiError(400, 'INVALID', 'Açık adres en az 5 karakter olmalı.');
    const body = {
      label: label.trim() || null,
      provinceId,
      districtId,
      neighborhood: neighborhood.trim() || null,
      addressLine: addressLine.trim(),
      buildingNo: buildingNo.trim() || null,
      apartmentNo: apartmentNo.trim() || null,
      instructions: instructions.trim() || null,
      latitude: coords?.latitude ?? null,
      longitude: coords?.longitude ?? null,
    };
    if (id) await addressApi.update(id, body);
    else await addressApi.create({ ...body, isDefault });
    router.back();
  });

  return (
    <Screen
      footer={
        <Button
          testID="save-address"
          title="Adresi Kaydet"
          onPress={() => void save.submit()}
          loading={save.busy}
        />
      }
    >
      <Button
        title="Mevcut Konumumu Kullan"
        icon={<BrandIcon kind="location" size={28} />}
        variant="secondary"
        onPress={() => void locate.submit()}
        loading={locate.busy}
      />
      {locationNote ? <Small>{locationNote}</Small> : null}
      <FormError message={locate.error} />
      <TextField
        label="Adres adı"
        value={label}
        onChangeText={setLabel}
        placeholder="Ev, İş…"
        maxLength={40}
      />
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
      <SelectField
        label="İlçe"
        placeholder={districts.loading && provinceId ? 'Yükleniyor…' : 'İlçe seçin'}
        options={(districts.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
        value={districtId}
        onChange={setDistrictId}
        disabled={!provinceId}
        disabledHint="Önce il seçin."
      />
      <TextField
        label="Mahalle"
        value={neighborhood}
        onChangeText={setNeighborhood}
        maxLength={120}
      />
      <TextField
        label="Açık adres"
        value={addressLine}
        onChangeText={setAddressLine}
        placeholder="Cadde, sokak"
        maxLength={300}
      />
      <View style={styles.row}>
        <View style={styles.flex}>
          <TextField
            label="Bina no"
            value={buildingNo}
            onChangeText={setBuildingNo}
            maxLength={20}
          />
        </View>
        <View style={styles.flex}>
          <TextField
            label="Daire"
            value={apartmentNo}
            onChangeText={setApartmentNo}
            maxLength={20}
          />
        </View>
      </View>
      <TextField
        label="Adres tarifi (isteğe bağlı)"
        value={instructions}
        onChangeText={setInstructions}
        multiline
        maxLength={500}
        hint="Yalnızca anlaştığınız usta görür."
      />
      {!id ? (
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Varsayılan adres yap</Text>
          <Switch
            value={isDefault}
            onValueChange={setIsDefault}
            accessibilityLabel="Varsayılan adres yap"
          />
        </View>
      ) : null}
      <Small>Yalnızca hizmet verilen iller listelenir.</Small>
      <FormError message={save.error} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 48,
  },
  switchLabel: { fontSize: 16, color: colors.textPrimary },
});
