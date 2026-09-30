import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, typography } from '../../lib/theme';

/** 48pt heart toggle; the state lives in useFavorite. */
export function FavoriteButton({
  isFavorite,
  onPress,
  name,
  testID,
}: {
  isFavorite: boolean;
  onPress: () => void;
  name: string;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: isFavorite }}
      accessibilityLabel={isFavorite ? `${name} favorilerden çıkar` : `${name} favorilere ekle`}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Text style={[styles.heart, isFavorite && styles.on]}>{isFavorite ? '♥' : '♡'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: typography.minTouchTarget,
    minHeight: typography.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  heart: { fontSize: 26, color: colors.textSecondary },
  on: { color: colors.emergency },
});
