import type { ProviderCard as ProviderCardData } from '@ustago/types';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Badge } from '../../components/Badge';
import { FormError } from '../../components/States';
import { colors, radii, spacing } from '../../lib/theme';
import { FavoriteButton } from './FavoriteButton';
import { ProviderAvatar } from './ProviderAvatar';
import { distanceText, ratingText, responseText } from './text';
import { useFavorite } from './useFavorite';

/** Identity check only; it says nothing about quality or rank. */
export const VERIFIED_LABEL = '✓ Kimliği doğrulandı';

interface Props {
  provider: ProviderCardData;
  onPress: (provider: ProviderCardData) => void;
  onFavoriteChange?: (providerId: string, isFavorite: boolean) => void;
  /** Hides the favorite heart (e.g. inside a list that manages favorites itself). */
  hideFavorite?: boolean;
}

/**
 * A provider in discovery, favorites and home lists. Every value is real
 * API data: no rating until the first review ("Yeni usta"), response stats
 * only above the server's minimum sample, straight-line distance only.
 */
export const ProviderCard = memo(function ProviderCard({
  provider: p,
  onPress,
  onFavoriteChange,
  hideFavorite,
}: Props) {
  const fav = useFavorite(
    p.id,
    p.isFavorite,
    onFavoriteChange ? (v) => onFavoriteChange(p.id, v) : undefined,
  );
  const rating = ratingText(p.rating);
  const distance = distanceText(p.distance);
  const response = responseText(p.responseStats);
  const summary = [
    p.displayName,
    p.isVerified ? 'kimliği doğrulandı' : null,
    rating ? `puan ${rating}` : null,
    `${p.completedJobCount} tamamlanan iş`,
    p.areaLabel,
    distance,
    p.availableToday ? 'bugün müsait' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={styles.card} testID={`provider-card-${p.id}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={summary}
        accessibilityHint="Usta profilini açar"
        onPress={() => onPress(p)}
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}
      >
        <ProviderAvatar name={p.displayName} photoUrl={p.photoUrl} />
        <View style={styles.body}>
          <Text style={styles.name} numberOfLines={1}>
            {p.displayName}
          </Text>
          <View style={styles.row}>
            {p.isVerified ? <Badge label={VERIFIED_LABEL} tone="success" /> : null}
            {p.isNewProvider ? <Badge label="Yeni usta" tone="info" /> : null}
            {p.availableToday ? <Badge label="Bugün müsait" tone="success" /> : null}
          </View>
          <Text style={styles.meta}>
            {rating ? `⭐ ${rating}` : 'Henüz değerlendirme yok'}
            {' · '}
            {p.completedJobCount > 0
              ? `${p.completedJobCount} tamamlanan iş`
              : 'Henüz tamamlanan iş yok'}
          </Text>
          <Text style={styles.meta} numberOfLines={2}>
            📍 {p.areaLabel}
            {distance ? ` · ${distance}` : ''}
          </Text>
          {response ? <Text style={styles.meta}>⏱ {response}</Text> : null}
        </View>
      </Pressable>
      {hideFavorite ? null : (
        <FavoriteButton
          testID={`favorite-${p.id}`}
          name={p.displayName}
          isFavorite={fav.isFavorite}
          onPress={() => void fav.toggle()}
        />
      )}
      {fav.error ? (
        <View style={styles.error}>
          <FormError message={fav.error} />
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    backgroundColor: colors.background,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
  },
  main: { flex: 1, flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
  pressed: { opacity: 0.8 },
  body: { flex: 1, gap: 4 },
  name: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  meta: { fontSize: 13, color: colors.textSecondary },
  error: { width: '100%', paddingRight: spacing.sm },
});
