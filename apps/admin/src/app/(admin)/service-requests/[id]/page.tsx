import { adminServiceRequestDetailSchema, formatMoney, uuidSchema } from '@ustago/validation';
import { colors, spacing } from '@ustago/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { QuoteStatusPill, RequestStatusPill, RequestTypePill } from '@/components/request-pills';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { formatDate, JOB_STATUS_LABELS, REVISION_KIND_LABELS } from '@/lib/labels';

import { DispatchSection, MatchPreviewSection } from './dispatch-section';

const SCHEDULE_LABEL = {
  NOW: 'Hemen',
  TODAY: 'Bugün',
  TOMORROW: 'Yarın',
  DATE: 'Belirli bir tarih',
} as const;

export default async function ServiceRequestDetailPage(props: PageProps<'/service-requests/[id]'>) {
  const { id: rawId } = await props.params;
  const id = uuidSchema.safeParse(rawId);
  if (!id.success) notFound();
  const preview = (await props.searchParams).preview === '1';
  await requireAdmin(`/service-requests/${id.data}${preview ? '?preview=1' : ''}`);

  const result = await apiRequest(`/admin/service-requests/${id.data}`, {
    schema: adminServiceRequestDetailSchema,
  });
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <p role="alert">{result.message}</p>;
  }
  const r = result.data;

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <Link href="/service-requests">← İş talepleri</Link>
      <header style={{ display: 'flex', gap: spacing.md, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1>{r.title}</h1>
        <RequestTypePill type={r.type} />
        <RequestStatusPill status={r.status} />
      </header>

      <section className="grid-2">
        <div className="card">
          <h2>Talep</h2>
          <dl>
            <dt>Kategori</dt>
            <dd>{r.category.name}</dd>
            <dt>Konum</dt>
            <dd>
              {r.location.neighborhood ? `${r.location.neighborhood}, ` : ''}
              {r.location.district.name} / {r.location.province.name}
            </dd>
            <dt>Müşteri bütçesi</dt>
            <dd>
              {r.budget
                ? `${formatMoney(r.budget)}${r.budgetMax ? `–${formatMoney(r.budgetMax)}` : ''} (bağlayıcı değil)`
                : 'Belirtilmedi'}
            </dd>
            <dt>Ne zaman</dt>
            <dd>{r.scheduleOption ? SCHEDULE_LABEL[r.scheduleOption] : 'Belirtilmedi'}</dd>
            <dt>Tercih edilen</dt>
            <dd>
              {r.preferredStartAt
                ? `${formatDate(r.preferredStartAt)} – ${formatDate(r.preferredEndAt)}`
                : 'Esnek'}
            </dd>
            <dt>Yayınlandı</dt>
            <dd>{formatDate(r.publishedAt)}</dd>
            <dt>Açık kalma</dt>
            <dd>{formatDate(r.expiresAt)}</dd>
            <dt>Fotoğraf</dt>
            <dd>{r.photoCount}</dd>
            {r.cancelledAt ? (
              <>
                <dt>İptal</dt>
                <dd>
                  {formatDate(r.cancelledAt)}
                  {r.cancelReason ? ` · ${r.cancelReason}` : ''}
                </dd>
              </>
            ) : null}
          </dl>
          <p style={{ marginTop: spacing.md, whiteSpace: 'pre-wrap' }}>{r.description}</p>
        </div>
        <div className="card">
          <h2>Müşteri</h2>
          <dl>
            <dt>Ad</dt>
            <dd>{r.customer.name}</dd>
            <dt>Telefon</dt>
            <dd>{r.customer.maskedPhone ?? '—'}</dd>
          </dl>
          <p style={{ color: colors.textSecondary, fontSize: 13, marginTop: spacing.sm }}>
            Telefon maskelidir; açık adres (sokak, bina, daire) yönetim panelinde gösterilmez.
          </p>
          <h2 style={{ marginTop: spacing.lg }}>İş</h2>
          {r.job ? (
            <dl>
              <dt>Durum</dt>
              <dd>
                <Link href={`/jobs/${r.job.id}`}>
                  {JOB_STATUS_LABELS[r.job.status]} · iş detayı
                </Link>
              </dd>
              <dt>Usta</dt>
              <dd>{r.job.provider.displayName}</dd>
              <dt>Anlaşılan fiyat</dt>
              <dd>
                <strong>{formatMoney(r.job.agreedPrice)}</strong> (kilitli)
              </dd>
              <dt>Güncel toplam</dt>
              <dd>{formatMoney(r.job.currentTotal)}</dd>
              <dt>Oluşturuldu</dt>
              <dd>{formatDate(r.job.createdAt)}</dd>
            </dl>
          ) : (
            <p>Henüz anlaşma yok.</p>
          )}
        </div>
      </section>

      <section style={{ display: 'grid', gap: spacing.md }}>
        <h2>Teklifler ({r.quotes.length})</h2>
        {r.quotes.length === 0 ? <p className="card">Henüz teklif yok.</p> : null}
        {r.quotes.map((q) => (
          <div key={q.id} className="card" style={{ display: 'grid', gap: spacing.sm }}>
            <div
              style={{ display: 'flex', gap: spacing.md, alignItems: 'center', flexWrap: 'wrap' }}
            >
              <Link href={`/providers/${q.provider.id}`}>
                <strong>{q.provider.displayName}</strong>
              </Link>
              <QuoteStatusPill status={q.status} />
              <span style={{ color: colors.textSecondary, fontSize: 13 }}>
                {formatDate(q.createdAt)}
              </span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Hamle</th>
                  <th>Tutar</th>
                  <th>Not</th>
                  <th>Zaman</th>
                </tr>
              </thead>
              <tbody>
                {q.revisions.map((rev) => (
                  <tr
                    key={rev.id}
                    style={rev.id === q.acceptedRevisionId ? { background: '#e7f6ec' } : undefined}
                  >
                    <td>{rev.revisionNo}</td>
                    <td>
                      {REVISION_KIND_LABELS[rev.kind]}
                      {rev.id === q.acceptedRevisionId ? ' ✓ kabul' : ''}
                    </td>
                    <td>
                      <strong>{formatMoney(rev.total)}</strong>
                    </td>
                    <td>{rev.note ?? '—'}</td>
                    <td>{formatDate(rev.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>

      <DispatchSection requestId={r.id} />
      <div id="eslestirme">
        <MatchPreviewSection requestId={r.id} enabled={preview} />
      </div>
    </div>
  );
}
