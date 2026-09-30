import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '../src/auth/AuthContext';
import { Splash } from '../src/components/Splash';
import { notificationTarget } from '../src/lib/notification-target';
import { onPushTapped } from '../src/lib/push';
import { colors } from '../src/lib/theme';

const PUBLIC_ROUTES = new Set(['', 'login', 'otp']);

/** Sends signed-out users to the login screen from anywhere. */
function AuthGate() {
  const { status } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const first = segments[0] ?? '';

  useEffect(() => {
    if (status === 'signedOut' && !PUBLIC_ROUTES.has(first)) router.replace('/login');
  }, [status, first, router]);
  return null;
}

/** A tapped push opens its deep link (or the job, quote or request it is about). */
function PushTapHandler() {
  const { status } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (status !== 'signedIn') return undefined;
    return onPushTapped((data) => {
      const target = notificationTarget({ data });
      if (target) router.push(target);
    });
  }, [status, router]);
  return null;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <Navigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

/**
 * Screens mount only after the stored session has been restored, so their
 * first requests already carry the access token.
 */
function Navigator() {
  const { status, offlineError, retry } = useAuth();
  if (status === 'loading') return <Splash />;
  if (status === 'offline') return <Splash error={offlineError} onRetry={retry} />;
  return (
    <>
      <AuthGate />
      <PushTapHandler />
      <Stack
        screenOptions={{
          headerTintColor: colors.primary,
          headerTitleStyle: { color: colors.textPrimary, fontWeight: '700' },
          headerBackTitle: 'Geri',
          contentStyle: { backgroundColor: colors.surface },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="otp" options={{ title: 'Doğrulama' }} />
        <Stack.Screen
          name="profile-setup"
          options={{ title: 'Hoş geldiniz', headerBackVisible: false }}
        />
        <Stack.Screen name="customer" options={{ headerShown: false }} />
        <Stack.Screen name="provider" options={{ headerShown: false }} />
        <Stack.Screen name="request/new" options={{ title: 'Yeni Talep' }} />
        <Stack.Screen name="request/[id]" options={{ title: 'Talep' }} />
        <Stack.Screen name="quote/[id]" options={{ title: 'Teklif ve Pazarlık' }} />
        <Stack.Screen name="job/[id]" options={{ title: 'İş' }} />
        <Stack.Screen name="notifications/index" options={{ title: 'Bildirimler' }} />
        <Stack.Screen name="notifications/preferences" options={{ title: 'Bildirim Tercihleri' }} />
        <Stack.Screen name="usta/[id]" options={{ title: 'Usta Profili' }} />
        <Stack.Screen name="search" options={{ title: 'Hizmet Ara' }} />
        <Stack.Screen name="providers/index" options={{ title: 'Ustalar' }} />
        <Stack.Screen name="favorites" options={{ title: 'Favori Ustalarım' }} />
        <Stack.Screen name="opportunity/[id]" options={{ title: 'İş Detayı' }} />
        <Stack.Screen name="addresses/index" options={{ title: 'Adreslerim' }} />
        <Stack.Screen name="addresses/edit" options={{ title: 'Adres' }} />
        <Stack.Screen name="provider-onboarding" options={{ title: 'Usta Başvurusu' }} />
        <Stack.Screen name="payments/index" options={{ title: 'Ödemelerim' }} />
        <Stack.Screen name="payments/[id]" options={{ title: 'Ödeme Özeti' }} />
        <Stack.Screen name="earnings/[id]" options={{ title: 'Kazanç Detayı' }} />
        <Stack.Screen name="payouts" options={{ title: 'Para Çek' }} />
        <Stack.Screen name="verification" options={{ title: 'Hesabımı Doğrula' }} />
        <Stack.Screen name="sessions" options={{ title: 'Aktif Oturumlar' }} />
        <Stack.Screen name="account-deletion" options={{ title: 'Hesap ve Verilerim' }} />
        <Stack.Screen name="unavailable" options={{ title: 'Bulunamadı' }} />
        <Stack.Screen name="messages/[id]" options={{ title: 'Mesajlar' }} />
        <Stack.Screen name="provider-settings/availability" options={{ title: 'Müsaitlik' }} />
        <Stack.Screen name="provider-settings/coverage" options={{ title: 'Hizmet Bölgeleri' }} />
        <Stack.Screen name="provider-settings/portfolio" options={{ title: 'Portföy' }} />
        <Stack.Screen name="provider-settings/photo" options={{ title: 'Profil Fotoğrafı' }} />
        <Stack.Screen name="provider-settings/reviews" options={{ title: 'Değerlendirmelerim' }} />
      </Stack>
    </>
  );
}
