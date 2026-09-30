import Image from 'next/image';

/**
 * Official UstaBulHemen artwork served from public/brand/. The ui/ copies are
 * the originals next to them, only cropped to the rounded tile and resized.
 */
export const BRAND_NAME = 'UstaBulHemen';

const SOURCES = {
  app: '/brand/ui/app-icon.png',
  main: '/brand/ui/main-icon.png',
  location: '/brand/ui/location-icon.png',
} as const;

/** A square brand image; the artwork is never stretched. */
export function BrandIcon({ kind, size }: { kind: keyof typeof SOURCES; size: number }) {
  return (
    <Image
      src={SOURCES[kind]}
      alt=""
      width={size}
      height={size}
      priority
      // Rounds off the tile's corners, matching the rounded square in the artwork.
      style={{ borderRadius: size * 0.22 }}
    />
  );
}
