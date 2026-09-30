import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { API_URL } from '../api/config';
import { isProvider, useAuth } from '../auth/AuthContext';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { DevHint } from '../components/DevHint';
import { Screen } from '../components/Screen';
import { Body, Heading, Small } from '../components/Text';
import { confirm } from '../lib/confirm';
import { formatPhone } from '../lib/format';
import { PROVIDER_STATUS } from '../lib/labels';
import { colors, spacing } from '../lib/theme';

/** Profile tab for both modes, with the mode switch. */
export function ProfileScreen({ mode }: { mode: 'customer' | 'provider' }) {
  const router = useRouter();
  const { user, signOut, setMode } = useAuth();
  if (!user) return null;
  const provider = user.providerProfile;

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
      </Card>

      {mode === 'customer' ? (
        isProvider(user) ? (
          <Button
            testID="switch-provider"
            title="🔧 Usta Moduna Geç"
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
          title="🏠 Müşteri Moduna Geç"
          onPress={() => void switchTo('customer')}
        />
      )}

      <Card>
        {mode === 'customer' ? (
          <>
            <Button title="Adreslerim" variant="ghost" onPress={() => router.push('/addresses')} />
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
              title="Başvuru ve hizmet bilgilerim"
              variant="ghost"
              onPress={() => router.push('/provider-onboarding')}
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
});
