import { adminDashboardStatsSchema } from '@ustago/validation';
import { colors, spacing } from '@ustago/ui';
import Link from 'next/link';

import { HealthBadge } from '@/components/health-badge';
import { apiRequest } from '@/lib/api';
import { fetchApiHealth } from '@/lib/api-health';
import { requireAdmin } from '@/lib/auth';
import { formatDate } from '@/lib/labels';

const TIME_ZONE = 'Europe/Istanbul';

export default async function DashboardPage() {
  await requireAdmin('/');
  const [health, stats] = await Promise.all([
    fetchApiHealth(),
    apiRequest(`/admin/stats?tz=${encodeURIComponent(TIME_ZONE)}`, {
      schema: adminDashboardStatsSchema,
    }),
  ]);

  const cards: {
    href: string;
    label: string;
    value: (s: StatsData) => number;
    urgent?: boolean;
  }[] = [
    { href: '/service-requests', label: 'Açık iş talebi', value: (s) => s.openServiceRequests },
    {
      href: '/service-requests?type=NOW',
      label: 'Açık ACİL talep',
      value: (s) => s.openNowRequests,
      urgent: true,
    },
    {
      href: '/service-requests',
      label: 'Bugün gelen talep',
      value: (s) => s.newServiceRequestsToday,
    },
    { href: '/service-requests?status=MATCHED', label: 'Oluşan iş', value: (s) => s.jobsCreated },
    { href: '/providers?status=ACTIVE', label: 'Aktif usta', value: (s) => s.activeProviders },
    {
      href: '/providers?status=PENDING_REVIEW',
      label: 'İnceleme bekleyen usta başvurusu',
      value: (s) => s.pendingProviders,
    },
    { href: '/providers', label: 'Toplam kullanıcı', value: (s) => s.totalUsers },
  ];

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <h1>Genel bakış</h1>
      {!stats.ok ? (
        <p role="alert">Sayılar alınamadı: {stats.message}</p>
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gap: spacing.md,
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            }}
          >
            {cards.map((card) => (
              <Link
                key={card.label}
                href={card.href}
                className="card stat"
                style={card.urgent ? { borderColor: colors.emergency } : undefined}
              >
                <span
                  className="stat-value"
                  style={card.urgent ? { color: colors.emergency } : undefined}
                >
                  {card.value(stats.data)}
                </span>
                <span style={{ color: colors.textSecondary }}>{card.label}</span>
              </Link>
            ))}
            <Link href="/verifications" className="card stat">
              <span className="stat-value">→</span>
              <span style={{ color: colors.textSecondary }}>Belge kuyruğu</span>
            </Link>
          </div>
          <p style={{ color: colors.textSecondary, fontSize: 13 }}>
            Veritabanından canlı okunur. “Bugün” {stats.data.timeZone} saatine göre hesaplanır. Son
            okuma: {formatDate(stats.data.generatedAt)}
          </p>
        </>
      )}
      <HealthBadge health={health} />
    </div>
  );
}

type StatsData = Extract<
  Awaited<ReturnType<typeof apiRequest<typeof adminDashboardStatsSchema>>>,
  { ok: true }
>['data'];
