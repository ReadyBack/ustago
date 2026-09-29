import type { ProviderStatus } from '@ustago/types';
import {
  adminProviderListItemSchema,
  paginatedSchema,
  providerStatusSchema,
} from '@ustago/validation';
import { spacing } from '@ustago/ui';
import Link from 'next/link';

import { ProviderStatusPill } from '@/components/status-pill';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { formatDate, PROVIDER_STATUS_LABELS } from '@/lib/labels';

const FILTERS: ProviderStatus[] = ['PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'DRAFT'];

export default async function ProvidersPage(props: PageProps<'/providers'>) {
  const params = await props.searchParams;
  const status = providerStatusSchema.catch('PENDING_REVIEW').parse(params['status']);
  const cursor = typeof params['cursor'] === 'string' ? params['cursor'] : undefined;
  await requireAdmin(`/providers?status=${status}`);

  const query = new URLSearchParams({ status, limit: '25', ...(cursor ? { cursor } : {}) });
  const result = await apiRequest(`/admin/providers?${query.toString()}`, {
    schema: paginatedSchema(adminProviderListItemSchema),
  });

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <h1>Usta başvuruları</h1>
      <nav aria-label="Durum" style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap' }}>
        {FILTERS.map((s) => (
          <Link
            key={s}
            href={`/providers?status=${s}`}
            className={`chip${s === status ? ' chip-active' : ''}`}
            aria-current={s === status ? 'page' : undefined}
          >
            {PROVIDER_STATUS_LABELS[s]}
          </Link>
        ))}
      </nav>
      {!result.ok ? (
        <p role="alert">{result.message}</p>
      ) : result.data.items.length === 0 ? (
        <p>Bu durumda başvuru yok.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Usta</th>
                <th>Başvuran</th>
                <th>Durum</th>
                <th>Gönderildi</th>
                <th>Bekleyen belge</th>
              </tr>
            </thead>
            <tbody>
              {result.data.items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/providers/${p.id}`}>{p.displayName}</Link>
                  </td>
                  <td>{p.contactName}</td>
                  <td>
                    <ProviderStatusPill status={p.status} />
                  </td>
                  <td>{formatDate(p.submittedAt)}</td>
                  <td>{p.pendingVerifications}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.ok && result.data.nextCursor ? (
        <Link href={`/providers?status=${status}&cursor=${result.data.nextCursor}`} className="btn">
          Sonraki sayfa
        </Link>
      ) : null}
    </div>
  );
}
