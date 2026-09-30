import type { ComponentType } from 'react';

import type { GeoPoint, PointCluster } from './cluster';

/**
 * A pin on a discovery map. The position is always approximate (a
 * provider's service-centre district centre from the API's `approxPoint`),
 * never an address (docs/adr/0029).
 */
export interface MapPin extends GeoPoint {
  /** Short text for screen readers and the pin's list, e.g. the provider's name. */
  label: string;
}

export interface MapViewProps {
  pins: MapPin[];
  /** Grid cell for clustering; implementations may pick one from the visible area. */
  cellSizeKm?: number;
  selectedClusterId?: string | null;
  onPressCluster: (cluster: PointCluster<MapPin>) => void;
  height?: number;
}

/**
 * Pluggable map rendering. The app ships `SchematicMapProvider` (no tiles,
 * no SDK, no API key). A real map SDK can be added later as another
 * implementation behind the same props; screens do not change. The list
 * view stays the accessible alternative in every case.
 */
export interface MapProvider {
  id: string;
  /** False for the schematic canvas: the UI then says no map service is connected. */
  showsRealMap: boolean;
  MapView: ComponentType<MapViewProps>;
}
