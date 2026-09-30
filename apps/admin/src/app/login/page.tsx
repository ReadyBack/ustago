import { colors, spacing } from '@ustago/ui';

import { BRAND_NAME, BrandIcon } from '@/components/brand';
import { safeNextPath } from '@/lib/safe-redirect';

import { LoginForm } from './login-form';

const ERRORS: Record<string, string> = {
  forbidden: 'Bu hesabın yönetim paneline erişim yetkisi yok.',
  expired: 'Oturumunuzun süresi doldu, lütfen yeniden giriş yapın.',
};

export default async function LoginPage(props: PageProps<'/login'>) {
  const params = await props.searchParams;
  const next = safeNextPath(params['next']);
  const errorKey = typeof params['error'] === 'string' ? params['error'] : undefined;

  return (
    <main
      style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: spacing.md }}
    >
      <section
        className="card"
        style={{ width: '100%', maxWidth: 380, display: 'grid', gap: spacing.lg }}
      >
        <header style={{ display: 'grid', justifyItems: 'center', textAlign: 'center' }}>
          <BrandIcon kind="app" size={72} />
          <h1 style={{ color: colors.primary }}>{BRAND_NAME} Yönetim</h1>
          <p style={{ color: colors.textSecondary }}>Yönetici hesabınızla giriş yapın.</p>
        </header>
        <LoginForm next={next} initialError={errorKey ? ERRORS[errorKey] : undefined} />
      </section>
    </main>
  );
}
