import { useRouter } from 'expo-router';

import { useAuth } from '../auth/AuthContext';
import { Screen } from '../components/Screen';
import { EmptyState } from '../components/States';

/** Where a notification or link lands when the app cannot open its target. */
export function UnavailableScreen() {
  const router = useRouter();
  const { mode } = useAuth();
  const home = mode === 'provider' ? '/provider' : '/customer';
  return (
    <Screen scroll={false}>
      <EmptyState
        icon="🔗"
        title="Bu içerik artık mevcut değil"
        body="Bağlantı açılamadı. İçerik kaldırılmış olabilir ya da uygulamanın bu sürümü onu henüz gösteremiyor."
        action={{
          title: 'Ana sayfaya dön',
          onPress: () => router.replace(home),
        }}
      />
    </Screen>
  );
}
