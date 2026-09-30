import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ProviderGate } from '../../src/components/ProviderGate';
import { MyJobsList } from '../../src/features/provider/MyJobsList';
import { MyQuotesList } from '../../src/features/provider/MyQuotesList';
import { OpportunityInbox } from '../../src/features/provider/OpportunityInbox';
import { colors, spacing, typography } from '../../src/lib/theme';

export type JobsSegment = 'inbox' | 'quotes' | 'active' | 'history';

const SEGMENTS: { value: JobsSegment; label: string }[] = [
  { value: 'inbox', label: 'Sana Uygun İşler' },
  { value: 'quotes', label: 'Tekliflerim' },
  { value: 'active', label: 'Aktif İşler' },
  { value: 'history', label: 'Geçmiş' },
];

const isSegment = (v: unknown): v is JobsSegment => SEGMENTS.some((s) => s.value === v);

/** "İşler": new work, my quotes, active and past jobs. `?segment=` picks one. */
export default function ProviderJobs() {
  const router = useRouter();
  const params = useLocalSearchParams<{ segment?: string; dispatched?: string }>();
  const segment: JobsSegment = isSegment(params.segment) ? params.segment : 'inbox';

  return (
    <ProviderGate>
      <View style={styles.fill}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.barWrap}
          contentContainerStyle={styles.bar}
          accessibilityRole="tablist"
        >
          {SEGMENTS.map((s) => {
            const selected = s.value === segment;
            return (
              <Pressable
                key={s.value}
                testID={`segment-${s.value}`}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => router.setParams({ segment: s.value })}
                style={[styles.tab, selected && styles.tabSelected]}
              >
                <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{s.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.fill}>
          {segment === 'inbox' ? (
            <OpportunityInbox
              key={params.dispatched === '1' ? 'dispatched' : 'all'}
              initialDispatchedOnly={params.dispatched === '1'}
            />
          ) : segment === 'quotes' ? (
            <MyQuotesList />
          ) : (
            <MyJobsList key={segment} scope={segment === 'active' ? 'ACTIVE' : 'FINISHED'} />
          )}
        </View>
      </View>
    </ProviderGate>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.surface },
  barWrap: {
    flexGrow: 0,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  bar: { paddingHorizontal: spacing.sm, gap: spacing.xs },
  tab: {
    minHeight: typography.minTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabSelected: { borderBottomColor: colors.primary },
  tabText: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },
  tabTextSelected: { color: colors.primary, fontWeight: '800' },
});
