import type { ApproxDistance } from '@ustago/types';

/**
 * Straight-line distances (docs/adr/0029). No road-routing service is used,
 * so every distance is labelled approximate ("Yaklaşık 12 km") and never
 * presented as a driving distance or a travel time.
 */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Swappable so a routing provider could be added later without touching callers. */
export interface DistanceCalculator {
  readonly kind: 'STRAIGHT_LINE';
  distanceKm(a: GeoPoint, b: GeoPoint): number;
}

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

export class HaversineDistanceCalculator implements DistanceCalculator {
  readonly kind = 'STRAIGHT_LINE' as const;

  distanceKm(a: GeoPoint, b: GeoPoint): number {
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  }
}

export const DISTANCE_CALCULATOR = Symbol('DISTANCE_CALCULATOR');

/**
 * Rounded for display: under 10 km to 0.5 km (never below 1), then whole
 * km. The rounding also hides exact centre positions.
 */
export function roundApproxKm(km: number): number {
  if (!Number.isFinite(km) || km < 0) return 1;
  if (km < 10) return Math.max(1, Math.round(km * 2) / 2);
  return Math.round(km);
}

export function approxDistance(km: number | null | undefined): ApproxDistance | null {
  if (km === null || km === undefined || !Number.isFinite(km)) return null;
  return { km: roundApproxKm(km), approximate: true };
}

/**
 * Coarsens a coordinate for storage on a request or for a map pin: 2
 * decimals ≈ 1.1 km of latitude. Exact addresses are never needed for
 * matching.
 */
export function coarsen(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Degrees of latitude/longitude spanning `km` around `lat` (bounding-box prefilter). */
export function boundingBox(
  center: GeoPoint,
  km: number,
): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} {
  const dLat = km / 110.574;
  const dLng = km / (111.32 * Math.max(0.01, Math.cos(toRad(center.lat))));
  return {
    minLat: center.lat - dLat,
    maxLat: center.lat + dLat,
    minLng: center.lng - dLng,
    maxLng: center.lng + dLng,
  };
}
