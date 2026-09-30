import { adminJobDetailSchema, formatMoney, uuidSchema } from '@ustago/validation';
import { colors, spacing } from '@ustago/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  DisputeStatusPill,
  JobStatusPill,
  RatingText,
  ReviewStatusPill,
} from '@/components/job-pills';
import { RequestTypePill } from '@/components/request-pills';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import {
  CHANGE_ORDER_STATUS_LABELS,
  DISPUTE_REASON_LABELS,
  formatDate,
  JOB_ACTOR_LABELS,
  JOB_STATUS_LABELS,
  JOB_STEP_LABELS,
  REVISION_KIND_LABELS,
} from '@/lib/labels';

export default async function JobDetailPage(props: PageProps<'/jobs/[id]'>) {
  const { id: rawId } = await props.params;
  const id = uuidSchema.safeParse(rawId);
  if (!id.success) notFound();
  await requireAdmin(`/jobs/${id.data}`);

  const result = await apiRequest(`/admin/jobs/${id.data}`, { schema: adminJobDetailSchema });
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <p role="alert">{result.message}</p>;
  }
  const j = result.data;
  const muted = { color: colors.textSecondary, fontSize: 13 };

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <Link href="/jobs">← İşler</Link>
      <header style={{ display: 'flex', gap: spacing.md, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1>{j.title}</h1>
        <RequestTypePill type={j.requestType} />
        <JobStatusPill status={j.status} />
      </header>

      <section className="grid-2">
        <div className="card">
          <h2>Özet</h2>
          <dl>
            <dt>Kategori</dt>
            <dd>{j.category.name}</dd>
            <dt>Konum</dt>
            <dd>
              {j.location.neighborhood ? `${j.location.neighborhood}, ` : ''}
              {j.location.district.name} / {j.location.province.name}
            </dd>
            <dt>Müşteri</dt>
            <dd>
              <Link href={`/jobs?customerId=${j.customer.id}`}>{j.customer.name}</Link> ·{' '}
              {j.customer.maskedPhone ?? '—'}
            </dd>
            <dt>Usta</dt>
            <dd>
              <Link href={`/providers/${j.provider.id}`}>{j.provider.displayName}</Link>
            </dd>
            <dt>Müşteri bütçesi</dt>
            <dd>
              {j.serviceRequest.budget ? formatMoney(j.serviceRequest.budget) : 'Belirtilmedi'}
            </dd>
            <dt>Anlaşılan fiyat</dt>
            <dd>
              <strong>{formatMoney(j.agreedPrice)}</strong> (kilitli)
            </dd>
            <dt>Güncel toplam</dt>
            <dd>{formatMoney(j.currentTotal)}</dd>
            <dt>Oluşturuldu</dt>
            <dd>{formatDate(j.createdAt)}</dd>
            <dt>Talep</dt>
            <dd>
              <Link href={`/service-requests/${j.serviceRequest.id}`}>
                {j.serviceRequest.title}
              </Link>
            </dd>
          </dl>
          <p style={{ ...muted, marginTop: spacing.sm }}>
            Telefon maskelidir; açık adres yönetim panelinde gösterilmez.
          </p>
          {j.cancellation ? (
            <p className="card" style={{ marginTop: spacing.sm, borderColor: colors.warning }}>
              <strong>İptal:</strong> {formatDate(j.cancellation.at)} ·{' '}
              {j.cancellation.actor ? JOB_ACTOR_LABELS[j.cancellation.actor] : '—'}
              {j.cancellation.reason ? ` · ${j.cancellation.reason}` : ''}
            </p>
          ) : null}
        </div>

        <div className="card">
          <h2>İş adımları</h2>
          <ol style={{ paddingLeft: 18, display: 'grid', gap: 4 }}>
            {j.timeline.map((t) => (
              <li key={t.step} style={t.at ? undefined : { color: colors.textSecondary }}>
                {JOB_STEP_LABELS[t.step]}: {t.at ? formatDate(t.at) : 'henüz değil'}
              </li>
            ))}
          </ol>
          <h3>Durum geçmişi</h3>
          <table>
            <thead>
              <tr>
                <th>Zaman</th>
                <th>Geçiş</th>
                <th>Yapan</th>
              </tr>
            </thead>
            <tbody>
              {j.statusHistory.map((h) => (
                <tr key={`${h.at}-${h.to}`}>
                  <td>{formatDate(h.at)}</td>
                  <td>
                    {h.from ? `${JOB_STATUS_LABELS[h.from]} → ` : ''}
                    {JOB_STATUS_LABELS[h.to]}
                    {h.reason ? <div style={muted}>{h.reason}</div> : null}
                  </td>
                  <td>{h.actor ? JOB_ACTOR_LABELS[h.actor] : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid-2">
        <div className="card">
          <h2>Pazarlık</h2>
          {j.negotiation.length === 0 ? (
            <p style={muted}>Kayıt yok.</p>
          ) : (
            <ol style={{ paddingLeft: 18, display: 'grid', gap: 4 }}>
              {j.negotiation.map((r) => (
                <li key={r.id}>
                  {REVISION_KIND_LABELS[r.kind]}: <strong>{formatMoney(r.total)}</strong>
                  {r.id === j.acceptedRevisionId ? ' ✓ kabul edildi' : ''}
                  <span style={muted}> · {formatDate(r.createdAt)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="card">
          <h2>Ek işler</h2>
          {j.changeOrders.length === 0 ? (
            <p style={muted}>Ek iş talebi yok.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Tutar</th>
                  <th>Durum</th>
                  <th>Toplam</th>
                </tr>
              </thead>
              <tbody>
                {j.changeOrders.map((c) => (
                  <tr key={c.id}>
                    <td>
                      +{formatMoney(c.amount)}
                      <div style={muted}>{c.description}</div>
                    </td>
                    <td>{CHANGE_ORDER_STATUS_LABELS[c.status]}</td>
                    <td>
                      {formatMoney(c.previousTotal)} → {formatMoney(c.proposedTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="grid-2">
        <div className="card">
          <h2>Değerlendirme</h2>
          {j.review ? (
            <div style={{ display: 'grid', gap: spacing.xs }}>
              <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center' }}>
                <RatingText value={j.review.rating} />
                <ReviewStatusPill status={j.review.status} />
              </div>
              {j.review.comment ? <p>“{j.review.comment}”</p> : null}
              <span style={muted}>
                {j.review.customerName} · {formatDate(j.review.createdAt)}
              </span>
              <Link href={`/reviews?providerId=${j.provider.id}`}>Değerlendirme moderasyonu →</Link>
            </div>
          ) : (
            <p style={muted}>Henüz değerlendirme yok.</p>
          )}
        </div>
        <div className="card">
          <h2>Sorun bildirimleri</h2>
          {j.disputes.length === 0 ? (
            <p style={muted}>Sorun bildirimi yok.</p>
          ) : (
            <ul style={{ display: 'grid', gap: 4 }}>
              {j.disputes.map((d) => (
                <li key={d.id}>
                  <Link href={`/disputes/${d.id}`}>{DISPUTE_REASON_LABELS[d.reason]}</Link>{' '}
                  <DisputeStatusPill status={d.status} />
                  <span style={muted}> · {formatDate(d.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="card">
        <h2>Denetim kaydı</h2>
        {j.audit.length === 0 ? (
          <p style={muted}>Kayıt yok.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Zaman</th>
                <th>İşlem</th>
                <th>Kayıt</th>
              </tr>
            </thead>
            <tbody>
              {j.audit.map((a, i) => (
                <tr key={`${a.at}-${a.action}-${i}`}>
                  <td>{formatDate(a.at)}</td>
                  <td>
                    <code>{a.action}</code>
                  </td>
                  <td>{a.entityType ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
