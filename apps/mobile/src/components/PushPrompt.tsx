import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { type PushSetup, registerForPush } from '../lib/push';
import { colors, spacing } from '../lib/theme';
import { Button } from './Button';
import { Card } from './Card';
import { DevHint } from './DevHint';
import { Body } from './Text';

let dismissedThisSession = false;

/**
 * Asks for notification permission with context, after sign-in, from the
 * home screen. Registers silently when permission was already granted.
 */
export function PushPrompt({ viewer }: { viewer: 'CUSTOMER' | 'PROVIDER' }) {
  const [setup, setSetup] = useState<PushSetup | null>(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(dismissedThisSession);

  useEffect(() => {
    let cancelled = false;
    void registerForPush(false).then((result) => {
      if (!cancelled) setSetup(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!setup || hidden) return null;
  if (setup.state === 'no-project-id') {
    return (
      <DevHint>
        Anlık bildirim izni var ama EAS projectId tanımlı değil; Expo push token alınamaz.
        Bildirimler uygulama içindeki listede görünür.
      </DevHint>
    );
  }
  if (setup.state === 'error') return <DevHint>{`Push kaydı başarısız: ${setup.message}`}</DevHint>;
  if (setup.state !== 'undetermined') return null;

  const why =
    viewer === 'CUSTOMER'
      ? 'Usta yola çıktığında, geldiğinde ve yeni teklif geldiğinde hemen haberiniz olsun.'
      : 'Size uygun yeni iş ve müşteri cevapları geldiğinde hemen haberiniz olsun.';
  return (
    <Card testID="push-prompt">
      <Text style={styles.title}>🔔 Bildirimleri açın</Text>
      <Body muted>{why}</Body>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Button
            title="Bildirimleri aç"
            loading={busy}
            onPress={() => {
              setBusy(true);
              void registerForPush(true).then((result) => {
                setBusy(false);
                setSetup(result);
              });
            }}
          />
        </View>
        <View style={styles.flex}>
          <Button
            title="Şimdi değil"
            variant="secondary"
            onPress={() => {
              dismissedThisSession = true;
              setHidden(true);
            }}
          />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: '800', color: colors.textPrimary },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
