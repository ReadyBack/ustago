import type { PublicProviderProfileV2 } from '@ustago/types';
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { providerV2Api } from '../../src/api/provider-v2';
import { api } from '../../src/api/session';
import { useAuth } from '../../src/auth/AuthContext';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Screen } from '../../src/components/Screen';
import { ErrorState, FormError, LoadingState } from '../../src/components/States';
import { Heading, Small } from '../../src/components/Text';
import { useApi } from '../../src/hooks/useApi';
import { useSubmit } from '../../src/hooks/useSubmit';
import { confirm } from '../../src/lib/confirm';
import { pickImage, uploadImage } from '../../src/lib/image-upload';
import { colors, spacing } from '../../src/lib/theme';

/** Profil fotoğrafı: upload intent → PUT the file → PUT /providers/me/photo; or remove it. */
export default function ProfilePhotoSettings() {
  const { user } = useAuth();
  const providerId = user?.providerProfile?.id ?? '';
  const profile = useApi<PublicProviderProfileV2>(
    providerId ? `provider:public:${providerId}` : '',
    () => providerV2Api.publicProfile(providerId),
  );
  const [photoUrl, setPhotoUrl] = useState<string | null | undefined>(undefined);
  const current = photoUrl === undefined ? (profile.data?.photoUrl ?? null) : photoUrl;

  const upload = useSubmit(async () => {
    const image = await pickImage();
    if (!image) return;
    const uploadId = await uploadImage(image, providerV2Api.photoUploadIntent);
    const res = await providerV2Api.setPhoto(uploadId);
    setPhotoUrl(res.photoUrl);
  });
  const remove = useSubmit(async () => {
    await providerV2Api.removePhoto();
    setPhotoUrl(null);
  });

  if (profile.loading) return <LoadingState />;
  if (profile.error) return <ErrorState message={profile.error} onRetry={profile.refresh} />;

  return (
    <Screen>
      <Card>
        <View style={styles.center}>
          {current ? (
            <Image
              source={{ uri: api.reachable(current) }}
              style={styles.photo}
              accessible
              accessibilityLabel="Profil fotoğrafın"
            />
          ) : (
            <View style={[styles.photo, styles.placeholder]}>
              <Text style={styles.placeholderText} accessibilityLabel="Profil fotoğrafı yok">
                👤
              </Text>
            </View>
          )}
        </View>
        <Heading>{current ? 'Profil fotoğrafın' : 'Henüz profil fotoğrafın yok'}</Heading>
        <Small>
          Yüzünün net göründüğü bir fotoğraf seç. JPEG veya PNG, en fazla 10 MB. Fotoğraf
          müşterilere profilinde ve tekliflerinde görünür.
        </Small>
        <FormError message={upload.error ?? remove.error} />
        <Button
          testID="upload-photo"
          title={current ? 'Fotoğrafı değiştir' : 'Fotoğraf yükle'}
          loading={upload.busy}
          onPress={() => void upload.submit()}
        />
        {current ? (
          <Button
            testID="remove-photo"
            title="Fotoğrafı kaldır"
            variant="danger"
            loading={remove.busy}
            onPress={() =>
              confirm(
                'Fotoğrafı kaldır',
                'Profil fotoğrafın silinecek.',
                () => void remove.submit(),
                {
                  yes: 'Kaldır',
                  destructive: true,
                },
              )
            }
          />
        ) : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', paddingVertical: spacing.sm },
  photo: { width: 140, height: 140, borderRadius: 70, backgroundColor: colors.surface },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  placeholderText: { fontSize: 56 },
});
