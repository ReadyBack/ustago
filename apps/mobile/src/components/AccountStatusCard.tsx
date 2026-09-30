import type { ProviderVerificationCaseView } from '@ustago/types';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { formatDate } from '../lib/format';
import { colors, radii, spacing, toneColors } from '../lib/theme';
import {
  ACCOUNT_STATUS,
  accountNotice,
  VERIFICATION_STATUS,
  VERIFIED_BADGE_LABEL,
} from '../lib/verification';
import { Badge } from './Badge';
import { Button } from './Button';
import { Card } from './Card';
import { Body, Heading, Small } from './Text';

/** CTA text for each verification state; null when there is nothing to do. */
function ctaTitle(view: ProviderVerificationCaseView): string | null {
  switch (view.status) {
    case 'NOT_STARTED':
    case 'IN_PROGRESS':
      return 'Hesabımı Doğrula';
    case 'NEEDS_REVISION':
      return 'Eksikleri tamamla';
    case 'REJECTED':
      return 'Gerekçeyi gör';
    case 'SUBMITTED':
    case 'UNDER_REVIEW':
      return 'Başvuruyu görüntüle';
    case 'VERIFIED':
    case 'SUSPENDED':
      return null;
  }
}

/**
 * "Hesap Durumu" on the provider home: verification and account status,
 * the reason written for the provider, and the way into the verification
 * flow. While the account is suspended it leads with a banner explaining
 * what is limited.
 */
export function AccountStatusCard({ view }: { view: ProviderVerificationCaseView }) {
  const router = useRouter();
  const notice = accountNotice(view);
  const verification = VERIFICATION_STATUS[view.status];
  const account = ACCOUNT_STATUS[view.accountStatus];
  const cta = ctaTitle(view);
  const reason = view.userVisibleReason;

  return (
    <Card
      testID="account-status-card"
      highlight={notice?.tone === 'danger' ? 'emergency' : undefined}
    >
      <Heading>Hesap Durumu</Heading>
      {notice ? (
        <View
          testID="account-notice"
          accessibilityRole="alert"
          style={[styles.banner, { backgroundColor: toneColors[notice.tone].bg }]}
        >
          <Text style={[styles.bannerTitle, { color: toneColors[notice.tone].fg }]}>
            {notice.title}
          </Text>
          <Body>{notice.body}</Body>
          {notice.reason ? <Body>Gerekçe: {notice.reason}</Body> : null}
          {notice.until ? <Small>Bitiş: {formatDate(notice.until)}</Small> : null}
        </View>
      ) : null}
      <View style={styles.row}>
        <Badge label={account.label} tone={account.tone} />
        <Badge label={`Doğrulama: ${verification.label}`} tone={verification.tone} />
      </View>
      {view.capabilities.restrictions.map((r) => (
        <Small key={r}>• {r}</Small>
      ))}
      {view.capabilities.showVerifiedBadge ? (
        <Text style={styles.verified}>{VERIFIED_BADGE_LABEL}</Text>
      ) : null}
      {reason && (view.status === 'NEEDS_REVISION' || view.status === 'REJECTED') ? (
        <View style={styles.reason}>
          <Text style={styles.reasonTitle}>
            {view.status === 'NEEDS_REVISION' ? 'Düzeltme istendi' : 'Gerekçe'}
          </Text>
          <Body>{reason}</Body>
        </View>
      ) : null}
      {view.status === 'NOT_STARTED' || view.status === 'IN_PROGRESS' ? (
        <Small>
          Hesabınızı doğrulayın: profilinizde “Kimliği/hesabı doğrulanmıştır” rozeti görünür.
        </Small>
      ) : null}
      {cta ? (
        <Button
          testID="open-verification"
          title={cta}
          variant={view.status === 'NEEDS_REVISION' ? 'primary' : 'secondary'}
          onPress={() => router.push('/verification')}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  banner: { borderRadius: radii.sm, padding: spacing.sm, gap: 4 },
  bannerTitle: { fontSize: 16, fontWeight: '800' },
  verified: { fontSize: 14, fontWeight: '700', color: colors.success },
  reason: {
    backgroundColor: colors.emergencySoft,
    borderRadius: radii.sm,
    padding: spacing.sm,
    gap: 2,
  },
  reasonTitle: { fontWeight: '700', color: colors.emergency },
});
