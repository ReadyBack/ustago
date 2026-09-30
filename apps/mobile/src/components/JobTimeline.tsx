import type { JobTimelineEntry } from '@ustago/types';
import { StyleSheet, Text, View } from 'react-native';

import { formatDateTime } from '../lib/format';
import { JOB_STEP } from '../lib/labels';
import { colors, spacing } from '../lib/theme';

/** The steps of a job with the real time each one happened. */
export function JobTimeline({ timeline }: { timeline: JobTimelineEntry[] }) {
  const lastDone = timeline.reduce((acc, t, i) => (t.at ? i : acc), -1);
  return (
    <View style={styles.list} accessibilityRole="list">
      {timeline.map((t, i) => {
        const done = t.at !== null;
        const current = i === lastDone;
        return (
          <View
            key={t.step}
            style={styles.row}
            accessible
            accessibilityLabel={`${JOB_STEP[t.step]}: ${done ? formatDateTime(t.at) : 'bekleniyor'}`}
          >
            <View style={styles.rail}>
              <View
                style={[styles.dot, done ? styles.dotDone : null, current && styles.dotCurrent]}
              />
              {i < timeline.length - 1 ? (
                <View style={[styles.line, done && timeline[i + 1]?.at ? styles.lineDone : null]} />
              ) : null}
            </View>
            <View style={styles.text}>
              <Text style={[styles.step, !done && styles.pending]}>
                {done ? '✓ ' : ''}
                {JOB_STEP[t.step]}
              </Text>
              <Text style={styles.time}>{done ? formatDateTime(t.at) : 'Bekleniyor'}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 0 },
  row: { flexDirection: 'row', gap: spacing.sm, minHeight: 44 },
  rail: { width: 18, alignItems: 'center' },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.background,
    marginTop: 3,
  },
  dotDone: { backgroundColor: colors.success, borderColor: colors.success },
  dotCurrent: { transform: [{ scale: 1.2 }] },
  line: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
  lineDone: { backgroundColor: colors.success },
  text: { flex: 1, paddingBottom: spacing.sm },
  step: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  pending: { color: colors.textSecondary, fontWeight: '500' },
  time: { fontSize: 13, color: colors.textSecondary },
});
