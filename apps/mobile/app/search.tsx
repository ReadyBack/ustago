import type { CategoryRef, SearchResult, ServiceCategoryNode } from '@ustago/types';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { errorMessage } from '../src/api/client';
import { searchApi } from '../src/api/customer-v2';
import { catalogApi } from '../src/api/services';
import { Chip } from '../src/components/Chip';
import { EmptyState, ErrorState, LoadingState } from '../src/components/States';
import { Heading, Small } from '../src/components/Text';
import { useApi } from '../src/hooks/useApi';
import { categoryIcon } from '../src/lib/categories';
import { colors, radii, spacing, typography } from '../src/lib/theme';

const SEARCH_DEBOUNCE_MS = 300;

interface Row {
  category: CategoryRef;
  hint: string | null;
}

/**
 * Category search with typo tolerance on the server. Picking a result is
 * recorded (POST /search/click, best effort) and opens provider discovery.
 */
export default function Search() {
  const router = useRouter();
  const [text, setText] = useState('');
  /** The answer for one query; anything else on screen is still loading. */
  const [answer, setAnswer] = useState<{
    query: string;
    result: SearchResult | null;
    error: string | null;
  } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const all = useApi<ServiceCategoryNode[]>('categories', catalogApi.categories);
  const q = text.trim().slice(0, 80);
  const current = answer?.query === q ? answer : null;
  const result = current?.result ?? null;
  const error = current?.error ?? null;
  const loading = q.length > 0 && current === null;

  useEffect(() => {
    controller.current?.abort();
    if (q.length === 0) return undefined;
    const timer = setTimeout(() => {
      const c = new AbortController();
      controller.current = c;
      searchApi.search(q, c.signal).then(
        (r) => {
          if (!c.signal.aborted) setAnswer({ query: q, result: r, error: null });
        },
        (e: unknown) => {
          if (!c.signal.aborted) setAnswer({ query: q, result: null, error: errorMessage(e) });
        },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => () => controller.current?.abort(), []);

  const pick = (c: CategoryRef) => {
    // Analytics must never block or fail the customer's tap.
    searchApi.click(c.id, q || undefined).catch(() => undefined);
    router.push({ pathname: '/providers', params: { categoryId: c.id, categoryName: c.name } });
  };

  const fuzzy = result?.categories.find((h) => h.matchKind === 'FUZZY') ?? null;
  const rows: Row[] =
    q.length === 0
      ? (all.data ?? []).map((c) => ({
          category: { id: c.id, slug: c.slug, name: c.name, icon: c.icon },
          hint: null,
        }))
      : (result?.categories ?? []).map((h) => ({
          category: h.category,
          hint:
            h.matchKind === 'ALIAS' &&
            h.matchedText.toLocaleLowerCase('tr-TR') !== h.category.name.toLocaleLowerCase('tr-TR')
              ? `“${h.matchedText}” ile eşleşti`
              : null,
        }));

  const header = (
    <View style={styles.header}>
      <TextInput
        testID="search-input"
        autoFocus
        value={text}
        onChangeText={setText}
        placeholder="Hizmet ara: elektrik, tesisat, boya…"
        placeholderTextColor={colors.muted}
        accessibilityLabel="Hizmet ara"
        returnKeyType="search"
        maxLength={80}
        style={styles.input}
        autoCorrect={false}
      />
      {fuzzy ? (
        <Pressable
          testID="did-you-mean"
          accessibilityRole="button"
          onPress={() => pick(fuzzy.category)}
          style={styles.fuzzy}
        >
          <Text style={styles.fuzzyText}>
            Bunu mu demek istediniz: <Text style={styles.bold}>{fuzzy.category.name}</Text>?
          </Text>
        </Pressable>
      ) : null}
      {q.length === 0 ? <Heading>Tüm hizmetler</Heading> : null}
    </View>
  );

  const empty = () => {
    if (q.length === 0) {
      if (all.loading) return <LoadingState />;
      if (all.error) return <ErrorState message={all.error} onRetry={all.refresh} />;
      return null;
    }
    if (loading) return <LoadingState label="Aranıyor…" />;
    if (error) return <ErrorState message={error} />;
    if (result?.noResult || (result && result.categories.length === 0)) {
      return (
        <View style={styles.noResult}>
          <EmptyState
            icon="🔎"
            title={`“${q}” için sonuç bulunamadı`}
            body={
              result.suggestions.length > 0
                ? 'Şunlardan birine bakmak ister misin?'
                : 'Farklı bir kelime dene, örneğin “musluk” yerine “tesisat”.'
            }
          />
          <View style={styles.chips}>
            {result.suggestions.map((c) => (
              <Chip
                key={c.id}
                label={`${categoryIcon(c.slug)} ${c.name}`}
                selected={false}
                onPress={() => pick(c)}
              />
            ))}
          </View>
        </View>
      );
    }
    return null;
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <FlatList
        data={q.length > 0 && (loading || error) ? [] : rows}
        keyExtractor={(r) => r.category.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ListEmptyComponent={empty()}
        contentContainerStyle={styles.content}
        renderItem={({ item }) => (
          <Pressable
            testID={`search-result-${item.category.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${item.category.name} ustalarını gör`}
            onPress={() => pick(item.category)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Text style={styles.icon}>{categoryIcon(item.category.slug)}</Text>
            <View style={styles.flex}>
              <Text style={styles.name}>{item.category.name}</Text>
              {item.hint ? <Small>{item.hint}</Small> : null}
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const ROW = 60;
const GAP = spacing.sm;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.md, gap: GAP, flexGrow: 1 },
  header: { gap: spacing.sm, marginBottom: spacing.xs },
  input: {
    minHeight: 52,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    fontSize: typography.fontSizeBody,
    color: colors.textPrimary,
  },
  fuzzy: {
    minHeight: typography.minTouchTarget,
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  fuzzyText: { fontSize: 15, color: colors.primaryDark },
  bold: { fontWeight: '800' },
  row: {
    height: ROW,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  pressed: { opacity: 0.8 },
  icon: { fontSize: 24 },
  flex: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  chevron: { fontSize: 24, color: colors.muted },
  noResult: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' },
});
