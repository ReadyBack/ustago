import { adminSystemStatusSchema } from '@ustago/validation';
import { colors, spacing } from '@ustago/ui';
import { notFound } from 'next/navigation';

import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { serverEnv } from '@/lib/env';
import { formatDate } from '@/lib/labels';

/**
 * Local development helper: what the admin panel is talking to. Not
 * available in production builds; shows no secrets (the API endpoint
 * returns none).
 */
export default async function DevStatusPage() {
  if (serverEnv.isProduction) notFound();
  await requireAdmin('/dev/status');
  const status = await apiRequest('/admin/system-status', { schema: adminSystemStatusSchema });

  const up = (value: 'up' | 'down') => (
    <span className={`pill ${value === 'up' ? 'pill-success' : 'pill-danger'}`}>
      {value === 'up' ? 'çalışıyor' : 'erişilemiyor'}
    </span>
  );

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <h1>Geliştirici durumu</h1>
      <p style={{ color: colors.textSecondary }}>
        Yalnızca yerel geliştirme içindir; production’da bu sayfa yoktur. Secret değerler
        gösterilmez.
      </p>
      {!status.ok ? (
        <p role="alert">{status.message}</p>
      ) : (
        <div className="card">
          <dl>
            <dt>Ortam</dt>
            <dd>{status.data.environment}</dd>
            <dt>API sürümü</dt>
            <dd>{status.data.version}</dd>
            <dt>API adresi</dt>
            <dd>{serverEnv.ADMIN_API_URL}</dd>
            <dt>PostgreSQL</dt>
            <dd>{up(status.data.database)}</dd>
            <dt>Redis</dt>
            <dd>{up(status.data.redis)}</dd>
            <dt>Dosya depolama</dt>
            <dd>{status.data.storageDriver}</dd>
            <dt>SMS sağlayıcı</dt>
            <dd>
              {status.data.smsProvider}
              {status.data.smsProvider === 'console' ? ' (OTP kodu API terminaline yazılır)' : ''}
            </dd>
            <dt>Swagger</dt>
            <dd>{status.data.swaggerEnabled ? `${serverEnv.ADMIN_API_URL}/api/docs` : 'kapalı'}</dd>
            <dt>İzinli originler (CORS)</dt>
            <dd>{status.data.corsOrigins.join(', ') || '—'}</dd>
            <dt>Kontrol</dt>
            <dd>{formatDate(status.data.checkedAt)}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}
