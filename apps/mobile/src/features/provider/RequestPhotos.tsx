import type { ServiceRequestPhoto } from '@ustago/types';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { requestApi } from '../../api/services';
import { api } from '../../api/session';
import { colors, radii, spacing } from '../../lib/theme';

/** The request's photos through short-lived signed URLs (private storage). */
export function RequestPhotos({
  requestId,
  photos,
}: {
  requestId: string;
  photos: ServiceRequestPhoto[];
}) {
  if (photos.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {photos.map((p, i) => (
        <Photo key={p.id} requestId={requestId} photoId={p.id} index={i + 1} />
      ))}
    </ScrollView>
  );
}

function Photo({
  requestId,
  photoId,
  index,
}: {
  requestId: string;
  photoId: string;
  index: number;
}) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    requestApi.photoUrl(requestId, photoId).then(
      (r) => alive && setUri(api.reachable(r.url)),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [requestId, photoId]);
  if (failed) {
    return (
      <View style={[styles.photo, styles.center]}>
        <Text style={styles.failed}>Fotoğraf yüklenemedi</Text>
      </View>
    );
  }
  if (!uri) {
    return (
      <View style={[styles.photo, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={styles.photo}
      accessible
      accessibilityLabel={`Talep fotoğrafı ${index}`}
      onError={() => setFailed(true)}
    />
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm },
  photo: { width: 120, height: 120, borderRadius: radii.md, backgroundColor: colors.surface },
  center: { alignItems: 'center', justifyContent: 'center', padding: 8 },
  failed: { fontSize: 12, color: colors.textSecondary, textAlign: 'center' },
});
