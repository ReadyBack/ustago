import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing } from '../../lib/theme';
import { boundsOf, clusterPoints, relativePosition, suggestedCellSizeKm } from './cluster';
import type { MapPin, MapProvider, MapViewProps } from './MapProvider';

export const SCHEMATIC_MAP_NOTE = 'Yaklaşık konumlar — harita servisi bağlı değil';

const PIN = 44;

/**
 * Approximate pins on a plain canvas: relative positions only, no tiles,
 * streets or SDK. Pins are district centres, so they never reveal where
 * anyone lives or works.
 */
function SchematicMapView({
  pins,
  cellSizeKm,
  selectedClusterId,
  onPressCluster,
  height = 280,
}: MapViewProps) {
  const bounds = useMemo(() => boundsOf(pins), [pins]);
  const clusters = useMemo(
    () => clusterPoints<MapPin>(pins, cellSizeKm ?? suggestedCellSizeKm(bounds)),
    [pins, cellSizeKm, bounds],
  );

  return (
    <View style={styles.wrap}>
      <View
        testID="schematic-map"
        style={[styles.canvas, { height }]}
        accessibilityLabel={`${SCHEMATIC_MAP_NOTE}. ${clusters.length} bölge.`}
      >
        {/* A faint grid so the canvas reads as a map sketch, not a real map. */}
        {[0.25, 0.5, 0.75].map((f) => (
          <View key={`h${f}`} style={[styles.gridH, { top: `${f * 100}%` }]} />
        ))}
        {[0.25, 0.5, 0.75].map((f) => (
          <View key={`v${f}`} style={[styles.gridV, { left: `${f * 100}%` }]} />
        ))}
        {bounds
          ? clusters.map((c) => {
              const pos = relativePosition(c, bounds);
              const count = c.points.length;
              const selected = c.id === selectedClusterId;
              const names = c.points.map((p) => p.label).join(', ');
              return (
                <Pressable
                  key={c.id}
                  testID={`map-pin-${c.id}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={
                    count === 1 ? `${names}, yaklaşık konum` : `${count} usta: ${names}`
                  }
                  onPress={() => onPressCluster(c)}
                  style={[
                    styles.pin,
                    selected && styles.pinSelected,
                    { left: `${pos.x * 100}%`, top: `${pos.y * 100}%` },
                  ]}
                >
                  <Text style={[styles.pinText, selected && styles.pinTextSelected]}>
                    {count === 1 ? '🔧' : count}
                  </Text>
                </Pressable>
              );
            })
          : null}
      </View>
      <Text style={styles.note}>{SCHEMATIC_MAP_NOTE}</Text>
    </View>
  );
}

export const SchematicMapProvider: MapProvider = {
  id: 'schematic',
  showsRealMap: false,
  MapView: SchematicMapView,
};

/** The implementation screens use; swap here when a real map service is connected. */
export const defaultMapProvider: MapProvider = SchematicMapProvider;

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  canvas: {
    backgroundColor: '#EEF3F8',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  gridH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  gridV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  pin: {
    position: 'absolute',
    width: PIN,
    height: PIN,
    marginLeft: -PIN / 2,
    marginTop: -PIN / 2,
    borderRadius: PIN / 2,
    backgroundColor: colors.background,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinSelected: { backgroundColor: colors.primary },
  pinText: { fontSize: 15, fontWeight: '800', color: colors.primaryDark },
  pinTextSelected: { color: colors.textInverse },
  note: { fontSize: 12, color: colors.textSecondary, textAlign: 'center' },
});
