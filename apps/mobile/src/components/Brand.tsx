import { Image, type ImageStyle, StyleSheet, Text, type TextStyle, View } from 'react-native';

import appIcon from '../../assets/brand/ui/app-icon.png';
import locationIcon from '../../assets/brand/ui/location-icon.png';
import mainIcon from '../../assets/brand/ui/main-icon.png';
import { colors, spacing } from '../lib/theme';

/**
 * Official UstaBulHemen artwork. The originals live next to these in
 * assets/brand/; the ui/ copies are only cropped to the rounded tile and
 * resized so the bundle stays small.
 */
export const brandImages = {
  main: mainIcon,
  app: appIcon,
  location: locationIcon,
};

export const BRAND_NAME = 'UstaBulHemen';
export const BRAND_SLOGAN = 'Usta mı lazım? Hemen bul.';

type Kind = keyof typeof brandImages;

/** Rounds off the tile's corners, matching the rounded square in the artwork. */
const TILE_RADIUS = 0.22;

/** A brand image at a square size; the artwork is never stretched. */
export function BrandIcon({ kind, size, style }: { kind: Kind; size: number; style?: ImageStyle }) {
  return (
    <Image
      source={brandImages[kind]}
      style={[{ width: size, height: size, borderRadius: size * TILE_RADIUS }, style]}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
      accessible={false}
    />
  );
}

/** "UstaBul" in navy and "Hemen" in orange, as in the official wordmark. */
export function BrandName({ size = 32, style }: { size?: number; style?: TextStyle }) {
  return (
    <Text
      style={[styles.name, { fontSize: size }, style]}
      accessibilityRole="header"
      accessibilityLabel={BRAND_NAME}
    >
      UstaBul<Text style={styles.accent}>Hemen</Text>
    </Text>
  );
}

/** Main logo, name and slogan: splash, login and other large brand areas. */
export function BrandHero({
  iconSize = 128,
  nameSize = 32,
}: {
  iconSize?: number;
  nameSize?: number;
}) {
  return (
    <View style={styles.hero}>
      <BrandIcon kind="main" size={iconSize} />
      <BrandName size={nameSize} />
      <Text style={styles.slogan}>{BRAND_SLOGAN}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.xs },
  name: { fontWeight: '900', color: colors.brandNavy, letterSpacing: -0.5 },
  accent: { color: colors.brandOrange },
  slogan: { fontSize: 15, fontWeight: '600', color: colors.brandSlate, letterSpacing: 0.5 },
});
