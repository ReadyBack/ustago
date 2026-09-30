import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { chatApi } from '../../api/chat';
import { api } from '../../api/session';
import { colors, radii } from '../../lib/theme';

/** Short-lived signed URLs, reused until shortly before they expire. */
const cache = new Map<string, { url: string; expiresAt: number }>();

async function signedUrl(messageId: string): Promise<string> {
  const hit = cache.get(messageId);
  if (hit && hit.expiresAt - Date.now() > 30_000) return hit.url;
  const res = await chatApi.imageUrl(messageId);
  const url = api.reachable(res.url);
  cache.set(messageId, { url, expiresAt: new Date(res.expiresAt).getTime() });
  return url;
}

/** A chat photo: the file is private, so each view asks for a signed URL. */
export function MessageImage({ messageId, localUri }: { messageId?: string; localUri?: string }) {
  const [uri, setUri] = useState<string | null>(localUri ?? null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (localUri || !messageId) return undefined;
    let alive = true;
    signedUrl(messageId).then(
      (u) => alive && setUri(u),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [messageId, localUri, attempt]);

  if (failed) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Fotoğraf yüklenemedi, tekrar dene"
        onPress={() => {
          if (messageId) cache.delete(messageId);
          setFailed(false);
          setAttempt((a) => a + 1);
        }}
        style={[styles.box, styles.center]}
      >
        <Text style={styles.failed}>Fotoğraf yüklenemedi. Tekrar denemek için dokun.</Text>
      </Pressable>
    );
  }
  if (!uri) {
    return (
      <View style={[styles.box, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={styles.box}
      resizeMode="cover"
      accessible
      accessibilityLabel="Sohbette paylaşılan fotoğraf"
      onError={() => setFailed(true)}
    />
  );
}

const styles = StyleSheet.create({
  box: { width: 200, height: 200, borderRadius: radii.md, backgroundColor: colors.surface },
  center: { alignItems: 'center', justifyContent: 'center', padding: 12 },
  failed: { fontSize: 13, color: colors.textSecondary, textAlign: 'center' },
});
