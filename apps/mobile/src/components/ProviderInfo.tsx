import type { QuoteProviderCard } from '@ustago/types';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '../lib/theme';
import { Badge } from './Badge';

/** Provider identity on a quote card: real rating from reviews, or "Yeni Usta". */
export function ProviderInfo({ provider }: { provider: QuoteProviderCard }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.avatar} accessibilityElementsHidden importantForAccessibility="no">
        <Text style={styles.avatarText}>
          {provider.displayName.slice(0, 1).toLocaleUpperCase('tr-TR')}
        </Text>
      </View>
      <View style={styles.flex}>
        <Text style={styles.name} numberOfLines={1}>
          {provider.displayName}
        </Text>
        <View style={styles.row}>
          {provider.rating ? (
            <Text style={styles.meta}>
              ⭐ {provider.rating.average.toFixed(1).replace('.', ',')} ({provider.rating.count}{' '}
              değerlendirme)
            </Text>
          ) : (
            <Badge label="Yeni Usta" tone="info" />
          )}
          {provider.identityVerified ? <Badge label="✓ Kimlik doğrulandı" tone="success" /> : null}
        </View>
        <Text style={styles.meta}>
          {provider.completedJobCount > 0
            ? `${provider.completedJobCount} tamamlanan iş`
            : 'Henüz tamamlanan iş yok'}
          {provider.yearsOfExperience !== null
            ? ` · ${provider.yearsOfExperience} yıl tecrübe`
            : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  flex: { flex: 1, gap: 3 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 18, fontWeight: '800', color: colors.primaryDark },
  name: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  row: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', alignItems: 'center' },
  meta: { fontSize: 13, color: colors.textSecondary },
});
