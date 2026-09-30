import type { ProviderVerificationCaseView } from '@ustago/types';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { API_URL } from '../api/config';
import { providerApi } from '../api/services';
import { isProvider, useAuth } from '../auth/AuthContext';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { DevHint } from '../components/DevHint';
import { Screen } from '../components/Screen';
import { Body, Heading, Small } from '../components/Text';
import { useApi } from '../hooks/useApi';
import { confirm } from '../lib/confirm';
import { formatPhone } from '../lib/format';
import { PROVIDER_STATUS } from '../lib/labels';
import { colors, spacing } from '../lib/theme';
import { VERIFICATION_STATUS, VERIFIED_BADGE_LABEL } from '../lib/verification';

/** Profile tab for both modes, with the mode switch. */
export function ProfileScreen({ mode }: { mode: 'customer' | 'provider' }) {
  const router = useRouter();
  const { user, signOut, setMode } = useAuth();
  const provider = user?.providerProfile ?? null;
  const verification = useApi<ProviderVerificationCaseView>(
    'provider:verification',
    providerApi.verificationCase,
    { enabled: mode === 'provider' && provider !== null },
  );
  if (!user) return null;
  const v = verification.data;

  const switchTo = async (next: 'customer' | 'provider') => {
    await setMode(next);
    router.replace(next === 'provider' ? '/provider' : '/customer');
  };

  return (
    <Screen>
      <Card>
        <Text style={styles.name}>
          {user.firstName} {user.lastName}
        </Text>
        <Small>{formatPhone(user.phone)}</Small>
        {provider ? (
          <View style={styles.row}>
            <Badge
              label={PROVIDER_STATUS[provider.status].label}
              tone={PROVIDER_STATUS[provider.status].tone}
            />
            <Small>{provider.displayName}</Small>
          </View>
        ) : null}
        {mode === 'provider' && v?.capabilities.showVerifiedBadge ? (
          <Text style={styles.verified}>{VERIFIED_BADGE_LABEL}</Text>
        ) : null}
      </Card>

      {mode === 'customer' ? (
        // An applicant (provider profile, not yet approved) may switch too: the
        // provider side shows their application state behind ProviderGate.
        isProvider(user) || provider !== null ? (
          <Button
            testID="switch-provider"
            title="🔧 Usta moduna geç"
            accessibilityHint="Usta hesabının işlerini ve tekliflerini gösterir"
            onPress={() => void switchTo('provider')}
          />
        ) : (
          <Card>
            <Heading>Usta mısınız?</Heading>
            <Body muted>
              Başvurunuzu tamamlayın, onaylandıktan sonra bölgenizdeki işlere teklif verin.
            </Body>
            <Button
              title="Usta Ol"
              variant="secondary"
              onPress={() => router.push('/provider-onboarding')}
            />
          </Card>
        )
      ) : (
        <Button
          testID="switch-customer"
          title="🏠 Müşteri moduna dön"
          onPress={() => void switchTo('customer')}
        />
      )}

      <Card>
        {mode === 'customer' ? (
          <>
            <Button title="Adreslerim" variant="ghost" onPress={() => router.push('/addresses')} />
            <Button
              testID="open-favorites"
              title="Favori ustalarım"
              variant="ghost"
              onPress={() => router.push('/favorites')}
            />
            <Button
              testID="open-notification-settings"
              title="Bildirim tercihleri"
              variant="ghost"
              onPress={() => router.push('/notifications/preferences')}
            />
            <Button
              testID="open-my-payments"
              title="Ödemelerim"
              variant="ghost"
              onPress={() => router.push('/payments')}
            />
          </>
        ) : (
          <>
            <Button
              testID="open-verification"
              title={
                v ? `Hesabımı Doğrula · ${VERIFICATION_STATUS[v.status].label}` : 'Hesabımı Doğrula'
              }
              variant="ghost"
              onPress={() => router.push('/verification')}
            />
            <Button
              title="Başvuru ve hizmet bilgilerim"
              variant="ghost"
              onPress={() => router.push('/provider-onboarding')}
            />
            <Button
              testID="open-provider-photo"
              title="Profil fotoğrafı"
              variant="ghost"
              onPress={() => router.push('/provider-settings/photo')}
            />
            <Button
              testID="open-availability"
              title="Müsaitlik ve çalışma saatleri"
              variant="ghost"
              onPress={() => router.push('/provider-settings/availability')}
            />
            <Button
              testID="open-coverage"
              title="Hizmet bölgeleri"
              variant="ghost"
              onPress={() => router.push('/provider-settings/coverage')}
            />
            <Button
              testID="open-portfolio"
              title="Portföy"
              variant="ghost"
              onPress={() => router.push('/provider-settings/portfolio')}
            />
            <Button
              testID="open-reviews"
              title="Değerlendirmelerim"
              variant="ghost"
              onPress={() => router.push('/provider-settings/reviews')}
            />
            <Button
              testID="open-earnings"
              title="Kazançlarım"
              variant="ghost"
              onPress={() => router.push('/provider/earnings')}
            />
            <Button
              testID="open-payouts"
              title="Para Çek"
              variant="ghost"
              onPress={() => router.push('/payouts')}
            />
          </>
        )}
        <Button
          title="Taleplerim / İşlerim"
          variant="ghost"
          onPress={() => router.push(mode === 'customer' ? '/customer/requests' : '/provider/jobs')}
        />
      </Card>

      <Card>
        <Heading>Güvenlik ve hesap</Heading>
        <Button
          testID="open-sessions"
          title="Aktif Oturumlar"
          variant="ghost"
          onPress={() => router.push('/sessions')}
        />
        <Button
          testID="open-account-deletion"
          title="Verilerim ve hesabı silme"
          variant="ghost"
          onPress={() => router.push('/account-deletion')}
        />
      </Card>

      <Button
        title="Çıkış Yap"
        variant="danger"
        onPress={() =>
          confirm('Çıkış yap', 'Bu cihazdaki oturumunuz kapatılacak.', () => void signOut(), {
            yes: 'Çıkış yap',
            destructive: true,
          })
        }
      />
      <DevHint>{`API: ${API_URL}`}</DevHint>
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 20, fontWeight: '800', color: colors.textPrimary },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  verified: { fontSize: 14, fontWeight: '700', color: colors.success },
});
