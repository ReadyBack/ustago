import { adminDisputeListItemSchema, paginatedSchema, uuidSchema } from '@ustago/validation';
import { colors, spacing } from '@ustago/ui';
import Link from 'next/link';

import { DisputeStatusPill, JobStatusPill } from '@/components/job-pills';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { DISPUTE_REASON_LABELS, formatDate } from '@/lib/labels';

type Group = 'OPEN' | 'RESOLVED';

export default async function DisputesPage(props: PageProps<'/disputes'>) {
  const params = await props.searchParams;
  const group: Group = params['group'] === 'RESOLVED' ? 'RESOLVED' : 'OPEN';
  const cursor = uuidSchema.safeParse(params['cursor']);
  const query = `group=${group}${cursor.success ? `&cursor=${cursor.data}` : ''}`;
  await requireAdmin(`/disputes?${query}`);

  const result = await apiRequest(`/admin/disputes?${query}&limit=25`, {
    schema: paginatedSchema(adminDisputeListItemSchema),
  });

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <h1>Sorun bildirimleri</h1>
      <nav aria-label="Grup" style={{ display: 'flex', gap: spacing.sm }}>
        {(['OPEN', 'RESOLVED'] as const).map((g) => (
          <Link
            key={g}
            href={`/disputes?group=${g}`}
            className={`btn${g === group ? ' btn-primary' : ''}`}
            aria-current={g === group ? 'page' : undefined}
          >
            {g === 'OPEN' ? 'Açık' : 'Sonuçlanan'}
          </Link>
        ))}
      </nav>
      {!result.ok ? (
        <p role="alert">{result.message}</p>
      ) : result.data.items.length === 0 ? (
        <p className="card">
          {group === 'OPEN' ? 'Açık sorun bildirimi yok.' : 'Sonuçlanan sorun bildirimi yok.'}
        </p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Sorun</th>
                <th>Durum</th>
                <th>İş</th>
                <th>Müşteri / Usta</th>
                <th>Bildirildi</th>
                <th>Sonuçlandı</th>
              </tr>
            </thead>
            <tbody>
              {result.data.items.map((d) => (
                <tr key={d.id}>
                  <td>
                    <Link href={`/disputes/${d.id}`}>{DISPUTE_REASON_LABELS[d.reason]}</Link>
                  </td>
                  <td>
                    <DisputeStatusPill status={d.status} />
                  </td>
                  <td>
                    <Link href={`/jobs/${d.job.id}`}>{d.job.title}</Link>
                    <div>
                      <JobStatusPill status={d.job.status} />
                    </div>
                  </td>
                  <td>
                    {d.customer.name}
                    <div style={{ color: colors.textSecondary, fontSize: 13 }}>
                      {d.provider.displayName}
                    </div>
                  </td>
                  <td>{formatDate(d.createdAt)}</td>
                  <td>{formatDate(d.resolvedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.ok && result.data.nextCursor ? (
        <Link href={`/disputes?group=${group}&cursor=${result.data.nextCursor}`} className="btn">
          Sonraki sayfa
        </Link>
      ) : null}
    </div>
  );
}
