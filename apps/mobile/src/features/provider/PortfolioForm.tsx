import type { PortfolioItem, ProviderServiceItem } from '@ustago/types';
import { MAX_PORTFOLIO_MEDIA_PER_ITEM } from '@ustago/validation';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '../../api/client';
import { providerV2Api } from '../../api/provider-v2';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { SelectField } from '../../components/SelectField';
import { FormError } from '../../components/States';
import { Heading, Small } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { useSubmit } from '../../hooks/useSubmit';
import { pickImage, uploadImage } from '../../lib/image-upload';
import { colors, radii, spacing, typography } from '../../lib/theme';
import {
  allConsentsGiven,
  buildPortfolioItem,
  buildPortfolioUpdate,
  PORTFOLIO_CONSENTS,
} from './portfolio';

const NO_CATEGORY = '__none__';

/** Create (photos + consent checklist) or edit (text and category) a portfolio item. */
export function PortfolioForm({
  services,
  editing,
  onSaved,
  onCancel,
}: {
  services: ProviderServiceItem[];
  /** Null creates a new item. */
  editing: PortfolioItem | null;
  onSaved: (item: PortfolioItem) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(editing?.title ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(editing?.category?.id ?? null);
  const [photos, setPhotos] = useState<{ uri: string; uploadId: string }[]>([]);
  const [consents, setConsents] = useState<Record<string, boolean>>({});

  const addPhoto = useSubmit(async () => {
    const image = await pickImage();
    if (!image) return;
    const uploadId = await uploadImage(image, providerV2Api.portfolioUploadIntent);
    setPhotos((list) => [...list, { uri: image.uri, uploadId }]);
  });

  const save = useSubmit(async () => {
    if (editing) {
      const built = buildPortfolioUpdate({ title, description, categoryId });
      if (!built.ok) throw new ApiError(400, 'INVALID_PORTFOLIO', built.error);
      onSaved(await providerV2Api.updatePortfolioItem(editing.id, built.body));
      return;
    }
    const built = buildPortfolioItem({
      title,
      description,
      categoryId,
      uploadIds: photos.map((p) => p.uploadId),
      consents,
    });
    if (!built.ok) throw new ApiError(400, 'INVALID_PORTFOLIO', built.error);
    onSaved(await providerV2Api.createPortfolioItem(built.body));
  });

  const categoryOptions = [
    { value: NO_CATEGORY, label: 'Kategori seçme' },
    ...services.map((s) => ({ value: s.categoryId, label: s.name })),
  ];

  return (
    <Card testID="portfolio-form">
      <Heading>{editing ? 'Çalışmayı düzenle' : 'Yeni çalışma'}</Heading>
      <TextField
        testID="portfolio-title"
        label="Başlık"
        value={title}
        onChangeText={setTitle}
        maxLength={120}
        placeholder="Örn. Salon klima montajı"
      />
      <TextField
        label="Açıklama (isteğe bağlı)"
        value={description}
        onChangeText={setDescription}
        maxLength={1000}
        multiline
      />
      <SelectField
        label="Kategori (isteğe bağlı)"
        placeholder="Kategori seçme"
        options={categoryOptions}
        value={categoryId ?? NO_CATEGORY}
        onChange={(v) => setCategoryId(v === NO_CATEGORY ? null : v)}
      />

      {editing ? (
        <Small>Fotoğraflar değiştirilemez; farklı fotoğraflar için yeni bir çalışma ekle.</Small>
      ) : (
        <>
          <Text style={styles.label}>
            Fotoğraflar ({photos.length}/{MAX_PORTFOLIO_MEDIA_PER_ITEM})
          </Text>
          <View style={styles.photos}>
            {photos.map((p, i) => (
              <View key={p.uploadId} style={styles.photoWrap}>
                <Image
                  source={{ uri: p.uri }}
                  style={styles.photo}
                  accessible
                  accessibilityLabel={`Fotoğraf ${i + 1}`}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Fotoğraf ${i + 1} kaldır`}
                  onPress={() => setPhotos((list) => list.filter((x) => x.uploadId !== p.uploadId))}
                  style={styles.removePhoto}
                >
                  <Text style={styles.removeText}>Kaldır</Text>
                </Pressable>
              </View>
            ))}
          </View>
          {photos.length < MAX_PORTFOLIO_MEDIA_PER_ITEM ? (
            <Button
              testID="portfolio-add-photo"
              title="+ Fotoğraf ekle"
              variant="secondary"
              loading={addPhoto.busy}
              onPress={() => void addPhoto.submit()}
            />
          ) : null}
          <FormError message={addPhoto.error} />

          <Text style={styles.label}>Paylaşmadan önce onayla</Text>
          {PORTFOLIO_CONSENTS.map((c) => {
            const checked = consents[c.key] === true;
            return (
              <Pressable
                key={c.key}
                testID={`consent-${c.key}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                onPress={() => setConsents((s) => ({ ...s, [c.key]: !checked }))}
                style={styles.consent}
              >
                <Text style={[styles.box, checked && styles.boxChecked]}>{checked ? '✓' : ''}</Text>
                <Text style={styles.consentText}>{c.label}</Text>
              </Pressable>
            );
          })}
          <Small>Fotoğraflarda otomatik yüz tanıma yapılmaz; kontrol senin sorumluluğunda.</Small>
        </>
      )}

      <FormError message={save.error} />
      <Button
        testID="portfolio-save"
        title="Kaydet"
        loading={save.busy}
        disabled={!editing && (!allConsentsGiven(consents) || photos.length === 0)}
        onPress={() => void save.submit()}
      />
      <Button title="Vazgeç" variant="ghost" onPress={onCancel} />
    </Card>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  photoWrap: { alignItems: 'center', gap: 2 },
  photo: { width: 88, height: 88, borderRadius: radii.sm, backgroundColor: colors.surface },
  removePhoto: { minHeight: typography.minTouchTarget, justifyContent: 'center' },
  removeText: { color: colors.emergency, fontWeight: '700', fontSize: 13 },
  consent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: typography.minTouchTarget,
  },
  box: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.primary,
    textAlign: 'center',
    lineHeight: 22,
    color: colors.textInverse,
    fontWeight: '800',
    overflow: 'hidden',
  },
  boxChecked: { backgroundColor: colors.primary },
  consentText: { flex: 1, fontSize: 15, color: colors.textPrimary },
});
