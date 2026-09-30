import type { ProviderStatus } from '@ustago/types';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';

import { useAuth } from '../auth/AuthContext';
import { Screen } from './Screen';
import { EmptyState } from './States';

const MESSAGES: Record<
  Exclude<ProviderStatus, 'ACTIVE'>,
  { icon: string; title: string; body: string; action: string }
> = {
  DRAFT: {
    icon: '📝',
    title: 'Başvurunuzu tamamlayın',
    body: 'Profil, hizmetler, hizmet bölgesi ve kimlik belgesi adımlarını bitirip incelemeye gönderin.',
    action: 'Başvuruya devam et',
  },
  PENDING_REVIEW: {
    icon: '⏳',
    title: 'Başvurunuz inceleniyor',
    body: 'Ekibimiz belgelerinizi kontrol ediyor. Onaylandığında bölgenizdeki işler burada görünecek.',
    action: 'Başvuruyu görüntüle',
  },
  REJECTED: {
    icon: '⚠️',
    title: 'Başvurunuz onaylanmadı',
    body: 'Gerekçeyi görüp eksikleri tamamlayarak yeniden başvurabilirsiniz.',
    action: 'Gerekçeyi gör',
  },
  SUSPENDED: {
    icon: '⛔',
    title: 'Hesabınız askıya alındı',
    body: 'Bu sürede yeni işlere teklif veremezsiniz. Ayrıntılar başvuru ekranında.',
    action: 'Ayrıntıları gör',
  },
};

/** Shows the provider's application state instead of the content until they are ACTIVE. */
export function ProviderGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user } = useAuth();
  const profile = user?.providerProfile;
  if (!profile) {
    return (
      <Screen scroll={false}>
        <EmptyState
          icon="🔧"
          title="Usta hesabınız yok"
          body="Usta olarak iş almak için kısa bir başvuru yapın."
          action={{ title: 'Usta Ol', onPress: () => router.push('/provider-onboarding') }}
        />
      </Screen>
    );
  }
  if (profile.status === 'ACTIVE') return <>{children}</>;
  const m = MESSAGES[profile.status];
  return (
    <Screen scroll={false}>
      <EmptyState
        icon={m.icon}
        title={m.title}
        body={m.body}
        action={{ title: m.action, onPress: () => router.push('/provider-onboarding') }}
      />
    </Screen>
  );
}
