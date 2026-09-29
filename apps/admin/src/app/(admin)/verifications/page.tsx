import { adminProviderVerificationSchema, paginatedSchema } from '@ustago/validation';
import { spacing } from '@ustago/ui';
import Link from 'next/link';

import { VerificationStatusPill } from '@/components/status-pill';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { formatDate, VERIFICATION_TYPE_LABELS } from '@/lib/labels';

export default async function VerificationQueuePage(props: PageProps<'/verifications'>) {
  const params = await props.searchParams;
  const cursor = typeof params['cursor'] === 'string' ? params['cursor'] : undefined;
  await requireAdmin('/verifications');

  const query = new URLSearchParams({
    status: 'PENDING',
    limit: '25',
    ...(cursor ? { cursor } : {}),
  });
  const result = await apiRequest(`/admin/provider-verifications?${query.toString()}`, {
    schema: paginatedSchema(adminProviderVerificationSchema),
  });

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <h1>Belge kuyruğu</h1>
      <p>En eski belge en üstte. Karar vermek için ustanın sayfasını açın.</p>
      {!result.ok ? (
        <p role="alert">{result.message}</p>
      ) : result.data.items.length === 0 ? (
        <p>İnceleme bekleyen belge yok.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Belge</th>
                <th>Durum</th>
                <th>Gönderildi</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {result.data.items.map((v) => (
                <tr key={v.id}>
                  <td>{VERIFICATION_TYPE_LABELS[v.type]}</td>
                  <td>
                    <VerificationStatusPill status={v.status} />
                  </td>
                  <td>{formatDate(v.submittedAt)}</td>
                  <td>
                    <Link href={`/providers/${v.providerId}`}>Ustayı aç</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.ok && result.data.nextCursor ? (
        <Link href={`/verifications?cursor=${result.data.nextCursor}`} className="btn">
          Sonraki sayfa
        </Link>
      ) : null}
    </div>
  );
}
