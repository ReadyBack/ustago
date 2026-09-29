import { colors, spacing } from '@ustago/ui';
import Link from 'next/link';

import { logout } from '@/app/login/actions';
import { currentAdmin } from '@/lib/auth';

export default async function AdminLayout({ children }: LayoutProps<'/'>) {
  // Each page enforces access with requireAdmin(its own path), so an
  // expired session returns the admin to the page they were on.
  const admin = await currentAdmin();
  if (!admin) return <>{children}</>;

  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateRows: 'auto 1fr' }}>
      <header className="topbar">
        <nav style={{ display: 'flex', gap: spacing.lg, alignItems: 'center', flexWrap: 'wrap' }}>
          <Link href="/" style={{ fontWeight: 700, color: colors.primary }}>
            UstaGO Yönetim
          </Link>
          <Link href="/providers">Usta başvuruları</Link>
          <Link href="/verifications">Belge kuyruğu</Link>
        </nav>
        <div style={{ display: 'flex', gap: spacing.md, alignItems: 'center' }}>
          <span style={{ color: colors.textSecondary }}>
            {admin.firstName} {admin.lastName}
          </span>
          <form action={logout}>
            <button type="submit" className="btn">
              Çıkış
            </button>
          </form>
        </div>
      </header>
      <main style={{ padding: spacing.lg, maxWidth: 1200, width: '100%', margin: '0 auto' }}>
        {children}
      </main>
    </div>
  );
}
