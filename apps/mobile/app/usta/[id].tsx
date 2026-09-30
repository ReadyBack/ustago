import type {
  Paginated,
  PortfolioItem,
  PublicProviderProfileV2,
  PublicReview,
  ReviewDistribution,
  ReviewSort,
} from '@ustago/types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { discoveryApi } from '../../src/api/customer-v2';
import { api } from '../../src/api/session';
import { Badge } from '../../src/components/Badge';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Chip } from '../../src/components/Chip';
import { Screen } from '../../src/components/Screen';
import { Stars } from '../../src/components/StarRating';
import { EmptyState, ErrorState, FormError, LoadingState } from '../../src/components/States';
import { Body, Heading, Small } from '../../src/components/Text';
import { FavoriteButton } from '../../src/features/customer/FavoriteButton';
import { ProviderAvatar } from '../../src/features/customer/ProviderAvatar';
import { VERIFIED_LABEL } from '../../src/features/customer/ProviderCard';
import { distanceText, ratingText, responseText } from '../../src/features/customer/text';
import { useDefaultAddress } from '../../src/features/customer/useDefaultAddress';
import { useFavorite } from '../../src/features/customer/useFavorite';
import { useApi } from '../../src/hooks/useApi';
import { useSubmit } from '../../src/hooks/useSubmit';
import { formatDate } from '../../src/lib/format';
import { colors, radii, spacing } from '../../src/lib/theme';

const REVIEW_SORTS: { value: ReviewSort; label: string }[] = [
  { value: 'NEWEST', label: 'En yeni' },
  { value: 'HIGHEST', label: 'En yüksek' },
  { value: 'LOWEST', label: 'En düşük' },
];
const STAR_FILTERS: (number | null)[] = [null, 5, 4, 3, 2, 1];

/**
 * Public provider profile V2. Real data only: rating from published
 * reviews, UstaScore shown separately, response stats only when the API
 * has enough samples, straight-line distance from the customer's default
 * district. Never phone, e-mail or address.
 */
export default function ProviderPublicProfile() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { address, settled } = useDefaultAddress();
  const districtId = address?.district.id ?? null;
  const profile = useApi<PublicProviderProfileV2>(
    settled ? `usta:${id}:${districtId ?? '-'}` : '',
    () => discoveryApi.profile(id, districtId),
  );
  const p = profile.data;
  const fav = useFavorite(id, p?.isFavorite ?? false);

  if (!settled || profile.loading) return <LoadingState />;
  if (profile.error || !p) {
    return <ErrorState message={profile.error ?? 'Usta bulunamadı.'} onRetry={profile.refresh} />;
  }
  const rating = ratingText(p.rating);
  const distance = distanceText(p.distance);
  const response = responseText(p.responseStats);
  const canRequest = p.availability.acceptingNewJobs;

  const requestQuote = () =>
    router.push({
      pathname: '/request/new',
      params: {
        type: 'QUOTE',
        preferredProviderId: p.id,
        preferredProviderName: p.displayName,
        providerCategoryIds: p.categories.map((c) => c.id).join(','),
        ...(p.categories.length === 1 && p.categories[0] ? { categoryId: p.categories[0].id } : {}),
      },
    });

  const footer = (
    <View style={styles.footerCol}>
      {!canRequest ? <Small>Bu usta şu an yeni iş almıyor.</Small> : null}
      <Button
        testID="request-from-provider"
        title="Bu ustadan teklif iste"
        onPress={requestQuote}
        disabled={!canRequest}
      />
    </View>
  );

  return (
    <Screen onRefresh={profile.refresh} refreshing={profile.refreshing} footer={footer}>
      <Card>
        <View style={styles.row}>
          <ProviderAvatar name={p.displayName} photoUrl={p.photoUrl} size={64} />
          <View style={styles.flex}>
            <Heading>{p.displayName}</Heading>
            <Small>
              UstaGO üyesi · {formatDate(p.memberSince)}
              {p.yearsOfExperience !== null ? ` · ${p.yearsOfExperience} yıl tecrübe` : ''}
            </Small>
          </View>
          <FavoriteButton
            testID="profile-favorite"
            name={p.displayName}
            isFavorite={fav.isFavorite}
            onPress={() => void fav.toggle()}
          />
        </View>
        <FormError message={fav.error} />
        <View style={styles.badges}>
          {p.isVerified ? <Badge label={VERIFIED_LABEL} tone="success" /> : null}
          {p.isNewProvider ? <Badge label="Yeni usta" tone="info" /> : null}
          {p.availability.onTimeOff ? (
            <Badge label="Şu an izinde" tone="warning" />
          ) : p.availability.availableToday ? (
            <Badge label="Bugün müsait" tone="success" />
          ) : null}
        </View>
        {p.isVerified ? (
          <Small>Kimlik doğrulaması kalite garantisi değildir; yorumları da incele.</Small>
        ) : null}
        <View style={styles.stats}>
          <Stat
            value={rating ? `⭐ ${p.rating?.average.toFixed(1).replace('.', ',')}` : '—'}
            label={p.rating ? `${p.rating.count} değerlendirme` : 'Henüz değerlendirme yok'}
          />
          <Stat value={String(p.completedJobCount)} label="tamamlanan iş" />
          {p.ustaScore !== null ? <Stat value={`${p.ustaScore}/100`} label="UstaScore" /> : null}
        </View>
        {p.ustaScore !== null ? (
          <Small>
            UstaScore; tamamlanan işler, iptaller, yorumlar ve doğrulamalardan hesaplanır. Kullanıcı
            puanından ayrıdır.
          </Small>
        ) : null}
        {distance ? <Body>📍 {distance} (kuş uçuşu)</Body> : null}
        {response ? <Body>⏱ {response}</Body> : null}
        {!p.availability.acceptingNewJobs ? <Body muted>Şu an yeni iş kabul etmiyor.</Body> : null}
      </Card>

      {p.bio ? (
        <Card>
          <Heading>Hakkında</Heading>
          <Body>{p.bio}</Body>
        </Card>
      ) : null}

      <Card>
        <Heading>Hizmetler ve bölgeler</Heading>
        <Body>{p.categories.map((c) => c.name).join(', ') || '—'}</Body>
        {p.serviceAreaLabels.map((label) => (
          <Small key={label}>📍 {label}</Small>
        ))}
      </Card>

      {p.portfolio.length > 0 ? <Portfolio items={p.portfolio} /> : null}

      <Reviews providerId={p.id} distribution={p.reviewDistribution} initial={p.recentReviews} />
    </Screen>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${value} ${label}`}>
      <Text style={styles.statValue}>{value}</Text>
      <Small>{label}</Small>
    </View>
  );
}

function Portfolio({ items }: { items: PortfolioItem[] }) {
  return (
    <View style={styles.section}>
      <Heading>Yaptığı işler</Heading>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.gallery}
      >
        {items.flatMap((item) =>
          item.media.map((m, i) => (
            <View key={m.id} style={styles.shot}>
              <Image
                source={{ uri: api.reachable(m.url) }}
                style={styles.shotImage}
                accessibilityLabel={`${item.title}${item.media.length > 1 ? `, fotoğraf ${i + 1}` : ''}`}
              />
              {i === 0 ? (
                <Text style={styles.shotTitle} numberOfLines={2}>
                  {item.title}
                </Text>
              ) : null}
            </View>
          )),
        )}
      </ScrollView>
    </View>
  );
}

function DistributionBars({ d }: { d: ReviewDistribution }) {
  const rows: [number, number][] = [
    [5, d.five],
    [4, d.four],
    [3, d.three],
    [2, d.two],
    [1, d.one],
  ];
  const total = rows.reduce((s, [, n]) => s + n, 0);
  if (total === 0) return null;
  return (
    <View style={styles.bars} testID="review-distribution">
      {rows.map(([star, n]) => (
        <View
          key={star}
          style={styles.barRow}
          accessible
          accessibilityLabel={`${star} yıldız: ${n} değerlendirme`}
        >
          <Text style={styles.barLabel}>{star} ★</Text>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${(n / total) * 100}%` }]} />
          </View>
          <Text style={styles.barCount}>{n}</Text>
        </View>
      ))}
    </View>
  );
}

function Reviews({
  providerId,
  distribution,
  initial,
}: {
  providerId: string;
  distribution: ReviewDistribution;
  initial: PublicReview[];
}) {
  const [sort, setSort] = useState<ReviewSort>('NEWEST');
  const [rating, setRating] = useState<number | null>(null);
  const key = `usta-reviews:${providerId}:${sort}:${rating ?? 'all'}`;
  const first = useApi<Paginated<PublicReview>>(key, () =>
    discoveryApi.reviews(providerId, { sort, rating, page: 0 }),
  );
  const [extra, setExtra] = useState<{
    key: string;
    items: PublicReview[];
    cursor: string | null;
    page: number;
  } | null>(null);
  const pages = extra?.key === key ? extra : null;
  const next = pages ? pages.cursor : (first.data?.nextCursor ?? null);
  const more = useSubmit(async () => {
    if (!next) return;
    const page = (pages?.page ?? 0) + 1;
    const res = await discoveryApi.reviews(providerId, { sort, rating, cursor: next, page });
    setExtra({ key, items: [...(pages?.items ?? []), ...res.items], cursor: res.nextCursor, page });
  });

  // Until the list loads, the profile's recent reviews stand in (default sort only).
  const loaded = first.data?.items ?? (sort === 'NEWEST' && rating === null ? initial : []);
  const seen = new Set<string>();
  const list = [...loaded, ...(pages?.items ?? [])].filter((r) => {
    if (seen.has(r.id) || (rating !== null && r.rating !== rating)) return false;
    seen.add(r.id);
    return true;
  });

  return (
    <View style={styles.section}>
      <Heading>Değerlendirmeler</Heading>
      <DistributionBars d={distribution} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {REVIEW_SORTS.map((s) => (
          <Chip
            key={s.value}
            label={s.label}
            selected={sort === s.value}
            onPress={() => setSort(s.value)}
          />
        ))}
      </ScrollView>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {STAR_FILTERS.map((s) => (
          <Chip
            key={s ?? 'all'}
            label={s === null ? 'Tümü' : `${s} ★`}
            selected={rating === s}
            onPress={() => setRating(s)}
          />
        ))}
      </ScrollView>
      {first.loading && list.length === 0 ? (
        <LoadingState label="Değerlendirmeler yükleniyor…" />
      ) : list.length === 0 ? (
        <EmptyState icon="⭐" title="Henüz değerlendirme yok" />
      ) : (
        list.map((r) => (
          <Card key={r.id} testID={`review-${r.id}`}>
            <View style={styles.between}>
              <Stars value={r.rating} />
              <Small>{formatDate(r.createdAt)}</Small>
            </View>
            {r.comment ? <Body>{r.comment}</Body> : null}
            <Small>
              {r.authorName} · {r.categoryName}
            </Small>
            {r.reply ? (
              <View style={styles.reply} testID={`review-reply-${r.id}`}>
                <Text style={styles.replyTitle}>Ustanın yanıtı</Text>
                <Body>{r.reply.body}</Body>
                <Small>{formatDate(r.reply.createdAt)}</Small>
              </View>
            ) : null}
          </Card>
        ))
      )}
      {next ? (
        <Button
          title="Daha fazla değerlendirme"
          variant="secondary"
          loading={more.busy}
          onPress={() => void more.submit()}
        />
      ) : null}
      <FormError message={more.error ?? first.error} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  flex: { flex: 1 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.sm,
    alignItems: 'center',
    gap: 2,
  },
  statValue: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  section: { gap: spacing.sm },
  chips: { gap: spacing.sm, paddingVertical: 2 },
  gallery: { gap: spacing.sm },
  shot: { width: 160, gap: 4 },
  shotImage: { width: 160, height: 120, borderRadius: radii.md, backgroundColor: colors.border },
  shotTitle: { fontSize: 13, color: colors.textPrimary, fontWeight: '600' },
  bars: { gap: 4 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  barLabel: { width: 32, fontSize: 13, color: colors.textSecondary },
  barTrack: {
    flex: 1,
    height: 8,
    backgroundColor: colors.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: { height: 8, backgroundColor: colors.warning },
  barCount: { width: 32, fontSize: 13, color: colors.textSecondary, textAlign: 'right' },
  reply: {
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    padding: spacing.sm,
    gap: 2,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  replyTitle: { fontSize: 13, fontWeight: '700', color: colors.primaryDark },
  footerCol: { gap: spacing.xs },
});
