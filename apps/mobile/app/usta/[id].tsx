import type { Paginated, PublicProviderProfile, PublicReview } from '@ustago/types';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { publicProviderApi } from '../../src/api/services';
import { Badge } from '../../src/components/Badge';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Screen } from '../../src/components/Screen';
import { Stars } from '../../src/components/StarRating';
import { ErrorState, FormError, LoadingState } from '../../src/components/States';
import { Body, Heading, Small } from '../../src/components/Text';
import { useApi } from '../../src/hooks/useApi';
import { useSubmit } from '../../src/hooks/useSubmit';
import { formatDate } from '../../src/lib/format';
import { VERIFICATION_BADGE } from '../../src/lib/labels';
import { colors, spacing } from '../../src/lib/theme';
import { VERIFIED_BADGE_LABEL } from '../../src/lib/verification';

/** Public provider profile: real ratings and reviews, no phone, e-mail or address. */
export default function ProviderPublicProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const profile = useApi<PublicProviderProfile>(`usta:${id}`, () => publicProviderApi.get(id));
  const reviews = useApi<Paginated<PublicReview>>(`usta-reviews:${id}`, () =>
    publicProviderApi.reviews(id),
  );
  const [older, setOlder] = useState<PublicReview[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const next = cursor === undefined ? (reviews.data?.nextCursor ?? null) : cursor;
  const more = useSubmit(async () => {
    if (!next) return;
    const page = await publicProviderApi.reviews(id, next);
    setOlder((o) => [...o, ...page.items]);
    setCursor(page.nextCursor);
  });

  if (profile.loading) return <LoadingState />;
  if (profile.error || !profile.data) {
    return <ErrorState message={profile.error ?? 'Usta bulunamadı.'} onRetry={profile.refresh} />;
  }
  const p = profile.data;
  const list = [...(reviews.data?.items ?? []), ...older];

  return (
    <Screen onRefresh={profile.refresh} refreshing={profile.refreshing}>
      <Card>
        <View style={styles.row}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {p.displayName.slice(0, 1).toLocaleUpperCase('tr-TR')}
            </Text>
          </View>
          <View style={styles.flex}>
            <Heading>{p.displayName}</Heading>
            <Small>UstaGO üyesi · {formatDate(p.memberSince)}</Small>
          </View>
        </View>
        {p.isVerified ? (
          <View accessible accessibilityLabel="Kimliği ve hesabı doğrulanmış usta">
            <Badge label={VERIFIED_BADGE_LABEL} tone="success" />
            <Small>Doğrulama kalite garantisi değildir; yorumları da inceleyin.</Small>
          </View>
        ) : null}
        {p.rating ? (
          <View
            style={styles.rating}
            accessible
            accessibilityLabel={`Kullanıcı puanı 5 üzerinden ${p.rating.average}, ${p.rating.count} değerlendirme`}
          >
            <Text style={styles.big}>⭐ {p.rating.average.toFixed(1).replace('.', ',')}</Text>
            <Small>{p.rating.count} değerlendirme</Small>
          </View>
        ) : (
          <Badge label="Yeni Usta" tone="info" />
        )}
        <Body>
          {p.completedJobCount > 0
            ? `${p.completedJobCount} tamamlanan iş`
            : 'Henüz tamamlanan iş yok'}
          {p.yearsOfExperience !== null ? ` · ${p.yearsOfExperience} yıl tecrübe` : ''}
        </Body>
        {p.ustaScore !== null ? (
          <Small>
            UstaScore: {p.ustaScore}/100 (tamamlanan işler, yorumlar ve doğrulamalardan hesaplanır)
          </Small>
        ) : null}
        <View style={styles.badges}>
          {p.verificationBadges.map((b) => (
            <Badge key={b} label={VERIFICATION_BADGE[b]} tone="success" />
          ))}
        </View>
        {p.bio ? <Body muted>{p.bio}</Body> : null}
      </Card>

      <Card>
        <Heading>Hizmetler</Heading>
        <Body>{p.services.map((s) => s.name).join(', ') || '—'}</Body>
        {p.serviceAreas.map((g) => (
          <Small key={g.province.id}>
            {g.province.name}: {g.districts.map((d) => d.name).join(', ')}
          </Small>
        ))}
      </Card>

      <Heading>Değerlendirmeler</Heading>
      {list.length === 0 ? (
        <Body muted>Henüz değerlendirme yok.</Body>
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
      <FormError message={more.error ?? reviews.error} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  flex: { flex: 1 },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 22, fontWeight: '800', color: colors.primaryDark },
  rating: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  big: { fontSize: 24, fontWeight: '800', color: colors.textPrimary },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
