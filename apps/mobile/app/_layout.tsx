import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '../src/auth/AuthContext';
import { Splash } from '../src/components/Splash';
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
        <Stack.Screen name="opportunity/[id]" options={{ title: 'İş Detayı' }} />
        <Stack.Screen name="addresses/index" options={{ title: 'Adreslerim' }} />
        <Stack.Screen name="addresses/edit" options={{ title: 'Adres' }} />
        <Stack.Screen name="provider-onboarding" options={{ title: 'Usta Başvurusu' }} />
      </Stack>
    </>
  );
}
