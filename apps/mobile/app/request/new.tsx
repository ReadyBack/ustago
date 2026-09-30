import type { Address, ServiceCategoryNode } from '@ustago/types';
import { MAX_REQUEST_PHOTOS, MIN_PRICE_MINOR, parseTryInput } from '@ustago/validation';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { ApiError } from '../../src/api/client';
import { addressApi, catalogApi, requestApi } from '../../src/api/services';
import { api } from '../../src/api/session';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Chip } from '../../src/components/Chip';
import { Screen } from '../../src/components/Screen';
import { EmptyState, ErrorState, FormError, LoadingState } from '../../src/components/States';
import { TextField } from '../../src/components/TextField';
import { Body, Heading, Small, Title } from '../../src/components/Text';
import { useApi } from '../../src/hooks/useApi';
import { useSubmit } from '../../src/hooks/useSubmit';
import { categoryIcon } from '../../src/lib/categories';
import { formatMoney } from '../../src/lib/format';
import { newIdempotencyKey } from '../../src/lib/id';
import { type When, windowFor } from '../../src/lib/when';
import { colors, radii, spacing } from '../../src/lib/theme';

type Step = 'category' | 'details' | 'address' | 'photos' | 'budget' | 'date' | 'preview';

interface Photo {
  uri: string;
  uploadId: string;
}

const WHEN_OPTIONS: { value: When; label: string }[] = [
  { value: 'FLEX', label: 'Esnek' },
  { value: 'TODAY', label: 'Bugün' },
  { value: 'TOMORROW', label: 'Yarın' },
  { value: 'WEEK', label: 'Bu hafta' },
];

export default function NewRequest() {
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string; categoryId?: string }>();
  const type = params.type === 'NOW' ? 'NOW' : 'QUOTE';
  const steps: Step[] =
    type === 'NOW'
      ? ['category', 'details', 'address', 'photos', 'budget', 'preview']
      : ['category', 'details', 'address', 'photos', 'budget', 'date', 'preview'];

  const [stepIndex, setStepIndex] = useState(params.categoryId ? 1 : 0);
  const [categoryId, setCategoryId] = useState<string | null>(params.categoryId ?? null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [pickedAddressId, setAddressId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [budgetUnknown, setBudgetUnknown] = useState(false);
  const [budgetText, setBudgetText] = useState('');
  const [when, setWhen] = useState<When>('FLEX');
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [stepError, setStepError] = useState<string | null>(null);

  const categories = useApi<ServiceCategoryNode[]>('categories', catalogApi.categories);
  const addresses = useApi<Address[]>('addresses', addressApi.list);
  const available = useMemo(
    () => (categories.data ?? []).filter((c) => (type === 'NOW' ? c.supportsNow : c.supportsQuote)),
    [categories.data, type],
  );
  const category = available.find((c) => c.id === categoryId) ?? null;
  // Until the customer picks one, the default (or first) address is used.
  const addressId =
    pickedAddressId ??
    (addresses.data?.find((a) => a.isDefault) ?? addresses.data?.[0])?.id ??
    null;
  const address = addresses.data?.find((a) => a.id === addressId) ?? null;
  const budgetMinor = budgetUnknown ? null : parseTryInput(budgetText);

  const step = steps[stepIndex] ?? 'category';

  const validate = (): string | null => {
    switch (step) {
      case 'category':
        return categoryId ? null : 'Lütfen bir hizmet seçin.';
      case 'details':
        if (title.trim().length < 3) return 'Başlık en az 3 karakter olmalı.';
        if (description.trim().length < 10) return 'Lütfen işi en az 10 karakterle anlatın.';
        return null;
      case 'address':
        return addressId ? null : 'Lütfen bir adres seçin veya ekleyin.';
      case 'budget':
        if (budgetUnknown) return null;
        if (budgetText.trim() === '')
          return 'Tutar girin veya “Bütçem belli değil” seçeneğini açın.';
        if (budgetMinor === null) return 'Tutarı 1.500 veya 1500,50 biçiminde yazın.';
        if (budgetMinor < MIN_PRICE_MINOR) return 'Bütçe en az ₺1 olmalı.';
        return null;
      default:
        return null;
    }
  };

  const next = () => {
    const problem = validate();
    setStepError(problem);
    if (!problem) setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  };
  const back = () => {
    setStepError(null);
    if (stepIndex === 0) router.back();
    else setStepIndex((i) => i - 1);
  };

  const addPhoto = useSubmit(async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    const asset = picked.canceled ? null : picked.assets[0];
    if (!asset) return;
    const mime =
      asset.mimeType ?? (asset.uri.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
    if (mime !== 'image/jpeg' && mime !== 'image/png') {
      throw new ApiError(
        422,
        'INVALID_REQUEST_PHOTO',
        'Yalnızca JPEG veya PNG fotoğraf ekleyebilirsiniz.',
      );
    }
    const blob = await api.readFile(asset.uri);
    if (blob.size > 10 * 1024 * 1024) {
      throw new ApiError(422, 'INVALID_REQUEST_PHOTO', 'Fotoğraf en fazla 10 MB olabilir.');
    }
    const intent = await requestApi.photoUploadIntent(mime, blob.size);
    await api.upload(intent.uploadUrl, blob, intent.headers);
    setPhotos((list) => [...list, { uri: asset.uri, uploadId: intent.uploadId }]);
  });

  const publish = useSubmit(async () => {
    if (!categoryId || !addressId) return;
    const window = type === 'QUOTE' ? windowFor(when) : { start: null, end: null };
    const created = await requestApi.create({
      type,
      categoryId,
      addressId,
      title: title.trim(),
      description: description.trim(),
      budgetMinor,
      preferredStartAt: window.start,
      preferredEndAt: window.end,
      photoUploadIds: photos.map((p) => p.uploadId),
      idempotencyKey,
    });
    router.replace(`/request/${created.id}`);
  });

  if (categories.loading || addresses.loading) return <LoadingState />;
  if (categories.error)
    return <ErrorState message={categories.error} onRetry={categories.refresh} />;

  const isLast = step === 'preview';
  const footer = (
    <View style={styles.footerRow}>
      <Button
        title={stepIndex === 0 ? 'Vazgeç' : 'Geri'}
        variant="secondary"
        onPress={back}
        style={styles.flex}
      />
      {isLast ? (
        <Button
          testID="publish-request"
          title={type === 'NOW' ? '🚨 Acil Talebi Gönder' : 'Talebi Yayınla'}
          variant={type === 'NOW' ? 'emergency' : 'primary'}
          onPress={() => void publish.submit()}
          loading={publish.busy}
          style={styles.flex2}
        />
      ) : (
        <Button testID="wizard-next" title="Devam" onPress={next} style={styles.flex2} />
      )}
    </View>
  );

  return (
    <Screen footer={footer}>
      <View style={styles.progressWrap}>
        <Small>
          Adım {stepIndex + 1}/{steps.length}
          {type === 'NOW' ? ' · 🚨 Acil talep' : ''}
        </Small>
        <View
          style={styles.progressTrack}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 1, max: steps.length, now: stepIndex + 1 }}
        >
          <View
            style={[styles.progressFill, { width: `${((stepIndex + 1) / steps.length) * 100}%` }]}
          />
        </View>
      </View>

      {step === 'category' ? (
        <>
          <Title>{type === 'NOW' ? 'Acil ne lazım?' : 'Hangi hizmet?'}</Title>
          {type === 'NOW' ? (
            <Body muted>Yalnızca acil hizmet verilen kategoriler listelenir.</Body>
          ) : null}
          <View style={styles.grid}>
            {available.map((c) => (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                accessibilityState={{ selected: c.id === categoryId }}
                onPress={() => setCategoryId(c.id)}
                style={[styles.tile, c.id === categoryId && styles.tileSelected]}
              >
                <Text style={styles.tileIcon}>{categoryIcon(c.slug)}</Text>
                <Text style={styles.tileText}>{c.name}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {step === 'details' ? (
        <>
          <Title>İşi anlatın</Title>
          {category ? (
            <Body muted>
              {categoryIcon(category.slug)} {category.name}
            </Body>
          ) : null}
          <TextField
            testID="request-title"
            label="Başlık"
            placeholder="Örn. Klima soğutmuyor"
            value={title}
            onChangeText={setTitle}
            maxLength={140}
          />
          <TextField
            testID="request-description"
            label="Açıklama"
            placeholder="Sorunu, cihaz markasını, kat bilgisini yazın. Ustalar daha doğru fiyat verir."
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={4000}
          />
        </>
      ) : null}

      {step === 'address' ? (
        <>
          <Title>Adres</Title>
          <Body muted>
            Açık adresiniz yalnızca anlaştığınız ustaya gösterilir; diğerleri sadece il/ilçeyi
            görür.
          </Body>
          {addresses.data?.length === 0 ? (
            <EmptyState
              icon="📍"
              title="Kayıtlı adresiniz yok"
              body="Devam etmek için bir adres ekleyin."
            />
          ) : (
            addresses.data?.map((a) => (
              <Card
                key={a.id}
                onPress={() => setAddressId(a.id)}
                highlight={a.id === addressId ? 'primary' : undefined}
                accessibilityLabel={`${a.label ?? 'Adres'}, ${a.district.name} ${a.province.name}`}
              >
                <Text style={styles.addrTitle}>
                  {a.id === addressId ? '● ' : '○ '}
                  {a.label ?? 'Adres'}
                </Text>
                <Small>
                  {a.addressLine} · {a.district.name} / {a.province.name}
                </Small>
              </Card>
            ))
          )}
          <Button
            title="+ Yeni adres ekle"
            variant="ghost"
            onPress={() => router.push('/addresses/edit')}
          />
          <Button
            title="Adres listesini yenile"
            variant="ghost"
            onPress={() => void addresses.refresh()}
          />
        </>
      ) : null}

      {step === 'photos' ? (
        <>
          <Title>Fotoğraf (isteğe bağlı)</Title>
          <Body muted>
            Fotoğraf, ustaların daha doğru fiyat vermesine yardım eder. JPEG veya PNG, en fazla 10
            MB.
          </Body>
          <View style={styles.photos}>
            {photos.map((p) => (
              <View key={p.uploadId} style={styles.photoWrap}>
                <Image
                  source={{ uri: p.uri }}
                  style={styles.photo}
                  accessibilityLabel="Eklenen fotoğraf"
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Fotoğrafı kaldır"
                  onPress={() => setPhotos((list) => list.filter((x) => x.uploadId !== p.uploadId))}
                  style={styles.photoRemove}
                >
                  <Text style={styles.photoRemoveText}>✕</Text>
                </Pressable>
              </View>
            ))}
          </View>
          {photos.length < MAX_REQUEST_PHOTOS ? (
            <Button
              title="📷 Fotoğraf ekle"
              variant="secondary"
              onPress={() => void addPhoto.submit()}
              loading={addPhoto.busy}
            />
          ) : null}
          <FormError message={addPhoto.error} />
        </>
      ) : null}

      {step === 'budget' ? (
        <>
          <Title>Bütçe</Title>
          <TextField
            testID="budget-input"
            label="Tahmini bütçeniz (ustalar farklı fiyat teklif edebilir)"
            prefix="₺"
            placeholder="1.500"
            keyboardType="decimal-pad"
            inputMode="decimal"
            value={budgetText}
            onChangeText={setBudgetText}
            editable={!budgetUnknown}
          />
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Bütçem belli değil</Text>
            <Switch
              testID="budget-unknown"
              value={budgetUnknown}
              onValueChange={(v) => {
                setBudgetUnknown(v);
                setStepError(null);
              }}
              accessibilityLabel="Bütçem belli değil"
            />
          </View>
          <Card style={styles.note}>
            <Body muted>
              Bütçe yalnızca bir tahmindir, teklif tavanı değildir. Ustalar işin gerçek maliyetine
              göre daha yüksek ya da düşük teklif verebilir; siz de karşı teklif yapabilirsiniz.
            </Body>
          </Card>
        </>
      ) : null}

      {step === 'date' ? (
        <>
          <Title>Ne zaman?</Title>
          <View style={styles.chips}>
            {WHEN_OPTIONS.map((o) => (
              <Chip
                key={o.value}
                label={o.label}
                selected={when === o.value}
                onPress={() => setWhen(o.value)}
              />
            ))}
          </View>
          <Body muted>Kesin saati anlaştığınız ustayla birlikte belirlersiniz.</Body>
        </>
      ) : null}

      {step === 'preview' ? (
        <>
          <Title>Kontrol edin</Title>
          <Card highlight={type === 'NOW' ? 'emergency' : undefined}>
            {type === 'NOW' ? <Text style={styles.nowBadge}>🚨 ACİL İŞ</Text> : null}
            <Heading>{title.trim()}</Heading>
            <Small>
              {category ? `${categoryIcon(category.slug)} ${category.name}` : ''}
              {address ? ` · ${address.district.name} / ${address.province.name}` : ''}
            </Small>
            <Body>{description.trim()}</Body>
            <Row
              label="Bütçe"
              value={
                budgetMinor === null ? 'Belirtilmedi (teklif bekliyorum)' : formatMoney(budgetMinor)
              }
            />
            {type === 'QUOTE' ? (
              <Row label="Zaman" value={WHEN_OPTIONS.find((o) => o.value === when)?.label ?? ''} />
            ) : (
              <Row label="Zaman" value="Hemen" />
            )}
            <Row label="Fotoğraf" value={photos.length === 0 ? 'Yok' : `${photos.length} adet`} />
          </Card>
          {type === 'NOW' ? (
            <Body muted>
              Talebiniz, bölgenizde şu an müsait ve acil hizmet veren ustalara iletilir. İlk gelen
              teklifi kabul edebilir veya reddedebilirsiniz.
            </Body>
          ) : (
            <Body muted>Talebiniz, bölgenizde bu hizmeti veren onaylı ustalara görünür.</Body>
          )}
          <FormError message={publish.error} />
        </>
      ) : null}

      <FormError message={stepError} />
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.previewRow}>
      <Text style={styles.previewLabel}>{label}</Text>
      <Text style={styles.previewValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flex2: { flex: 2 },
  footerRow: { flexDirection: 'row', gap: spacing.sm },
  progressWrap: { gap: spacing.xs },
  progressTrack: { height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, backgroundColor: colors.primary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    width: '47%',
    flexGrow: 1,
    minHeight: 72,
    backgroundColor: colors.background,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    flexDirection: 'row',
    padding: spacing.md,
    gap: spacing.sm,
  },
  tileSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  tileIcon: { fontSize: 24 },
  tileText: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, flexShrink: 1 },
  addrTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  photoWrap: { position: 'relative' },
  photo: { width: 96, height: 96, borderRadius: radii.md, backgroundColor: colors.border },
  photoRemove: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoRemoveText: { color: colors.textInverse, fontWeight: '700' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  switchLabel: { fontSize: 16, color: colors.textPrimary, fontWeight: '500' },
  note: { backgroundColor: colors.primarySoft, borderColor: colors.primarySoft },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  nowBadge: { color: colors.emergency, fontWeight: '900', fontSize: 13 },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  previewLabel: { color: colors.textSecondary, fontSize: 14 },
  previewValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
  },
});
