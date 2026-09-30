/**
 * Grid clustering for approximate map pins. Pure and deterministic, so the
 * same providers always cluster the same way on every map implementation.
 *
 * Points are projected onto a flat plane in kilometres (equirectangular,
 * around the points' mean latitude: plenty for a city or a province) and
 * binned into square cells of `cellSizeKm`. Each non-empty cell is one
 * cluster, placed at the mean of its points.
 */

export interface GeoPoint {
  id: string;
  lat: number;
  lng: number;
}

export interface PointCluster<P extends GeoPoint = GeoPoint> {
  /** Stable for the same members: "c:<first member id>". */
  id: string;
  lat: number;
  lng: number;
  points: P[];
}

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LNG_EQUATOR = 111.32;

export function clusterPoints<P extends GeoPoint>(
  points: P[],
  cellSizeKm: number,
): PointCluster<P>[] {
  const valid = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (valid.length === 0) return [];
  const size = cellSizeKm > 0 && Number.isFinite(cellSizeKm) ? cellSizeKm : 1;
  const meanLat = valid.reduce((s, p) => s + p.lat, 0) / valid.length;
  const kmPerDegLng = KM_PER_DEG_LNG_EQUATOR * Math.cos((meanLat * Math.PI) / 180);

  const cells = new Map<string, P[]>();
  for (const p of valid) {
    const x = Math.floor((p.lng * kmPerDegLng) / size);
    const y = Math.floor((p.lat * KM_PER_DEG_LAT) / size);
    const key = `${x}:${y}`;
    const cell = cells.get(key);
    if (cell) cell.push(p);
    else cells.set(key, [p]);
  }

  const clusters: PointCluster<P>[] = [];
  for (const members of cells.values()) {
    const sorted = [...members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    clusters.push({
      id: `c:${sorted[0]?.id ?? ''}`,
      lat: sorted.reduce((s, p) => s + p.lat, 0) / sorted.length,
      lng: sorted.reduce((s, p) => s + p.lng, 0) / sorted.length,
      points: sorted,
    });
  }
  // Biggest first, then north to south, then by id: a stable reading order.
  return clusters.sort(
    (a, b) => b.points.length - a.points.length || b.lat - a.lat || (a.id < b.id ? -1 : 1),
  );
}

export interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export function boundsOf(points: { lat: number; lng: number }[]): Bounds | null {
  if (points.length === 0) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  return { minLat, maxLat, minLng, maxLng };
}

/**
 * Relative position (0..1, y down) of a point inside the bounds, with a
 * margin so pins never touch the edge. A single point sits in the middle.
 */
export function relativePosition(
  p: { lat: number; lng: number },
  b: Bounds,
  margin = 0.12,
): { x: number; y: number } {
  const span = (lo: number, hi: number, v: number) => (hi - lo < 1e-9 ? 0.5 : (v - lo) / (hi - lo));
  const inner = 1 - margin * 2;
  return {
    x: margin + span(b.minLng, b.maxLng, p.lng) * inner,
    y: margin + (1 - span(b.minLat, b.maxLat, p.lat)) * inner,
  };
}

/** A cell size that yields a readable number of pins for the area shown. */
export function suggestedCellSizeKm(b: Bounds | null): number {
  if (!b) return 2;
  const heightKm = (b.maxLat - b.minLat) * KM_PER_DEG_LAT;
  const midLat = (b.maxLat + b.minLat) / 2;
  const widthKm =
    (b.maxLng - b.minLng) * KM_PER_DEG_LNG_EQUATOR * Math.cos((midLat * Math.PI) / 180);
  const extent = Math.max(heightKm, widthKm);
  // Roughly a 6 x 6 grid over the visible area, never finer than 1 km.
  return Math.max(1, Math.round(extent / 6));
}
