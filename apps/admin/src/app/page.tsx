import { colors, spacing } from '@ustago/ui';

import { HealthBadge } from '@/components/health-badge';
import { fetchApiHealth } from '@/lib/api-health';

// Always render on request so the status reflects the live API.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const health = await fetchApiHealth();

  return (
    <main style={{ padding: spacing.xl, display: 'grid', gap: spacing.md }}>
      <h1 style={{ color: colors.primary }}>UstaGO Admin</h1>
      <p style={{ color: colors.textSecondary }}>
        Faz 0: altyapı hazır. Yönetim ekranları sonraki fazlarda eklenecek.
      </p>
      <HealthBadge health={health} />
    </main>
  );
}
