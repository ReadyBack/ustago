import {
  adminProviderListItemSchema,
  adminProviderVerificationSchema,
  paginatedSchema,
} from '@ustago/validation';
import { colors, spacing } from '@ustago/ui';
import Link from 'next/link';

import { HealthBadge } from '@/components/health-badge';
import { apiRequest } from '@/lib/api';
import { fetchApiHealth } from '@/lib/api-health';
import { requireAdmin } from '@/lib/auth';

export default async function DashboardPage() {
  await requireAdmin('/');
  const [health, providers, verifications] = await Promise.all([
    fetchApiHealth(),
    apiRequest('/admin/providers?status=PENDING_REVIEW&limit=100', {
      schema: paginatedSchema(adminProviderListItemSchema),
    }),
    apiRequest('/admin/provider-verifications?status=PENDING&limit=100', {
      schema: paginatedSchema(adminProviderVerificationSchema),
    }),
  ]);

  const count = (r: typeof providers | typeof verifications) =>
    r.ok ? `${r.data.items.length}${r.data.nextCursor ? '+' : ''}` : '—';

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <h1>Genel bakış</h1>
      <div
        style={{
          display: 'grid',
          gap: spacing.md,
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        }}
      >
        <Link href="/providers" className="card stat">
          <span className="stat-value">{count(providers)}</span>
          <span style={{ color: colors.textSecondary }}>İnceleme bekleyen usta başvurusu</span>
        </Link>
        <Link href="/verifications" className="card stat">
          <span className="stat-value">{count(verifications)}</span>
          <span style={{ color: colors.textSecondary }}>İnceleme bekleyen belge</span>
        </Link>
      </div>
      <HealthBadge health={health} />
    </div>
  );
}
