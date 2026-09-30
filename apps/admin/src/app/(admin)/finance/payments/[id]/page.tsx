import { adminPaymentDetailSchema, formatBps, formatMoney, uuidSchema } from '@ustago/validation';
import { colors, spacing } from '@ustago/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  AttemptStatusPill,
  EarningStatusPill,
  PaymentStatusPill,
  RefundStatusPill,
} from '@/components/finance-pills';
import { LedgerTransaction } from '@/components/ledger-transaction';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { formatDate, PAYMENT_METHOD_LABELS, REFUND_REASON_LABELS } from '@/lib/labels';

export default async function PaymentDetailPage(props: PageProps<'/finance/payments/[id]'>) {
  const { id: rawId } = await props.params;
  const id = uuidSchema.safeParse(rawId);
  if (!id.success) notFound();
  await requireAdmin(`/finance/payments/${id.data}`);

  const result = await apiRequest(`/admin/finance/payments/${id.data}`, {
    schema: adminPaymentDetailSchema,
  });
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <p role="alert">{result.message}</p>;
  }
  const p = result.data;

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <Link href="/finance/payments">← Ödemeler</Link>
      <header style={{ display: 'flex', gap: spacing.md, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1>Ödeme: {formatMoney(p.amount)}</h1>
        <PaymentStatusPill status={p.status} />
        {p.testMode ? <span className="pill pill-warning">Test ödemesi</span> : null}
        {p.refundable.amountMinor > 0 ? (
          <Link href={`/finance/payments/${p.id}/refund`} className="btn btn-danger">
            İade başlat
          </Link>
        ) : null}
      </header>

      <section className="grid-2">
        <div className="card">
          <h2>Tutarlar</h2>
          <dl>
            <dt>Ödenen</dt>
            <dd>{formatMoney(p.amount)}</dd>
            <dt>İade edilen</dt>
            <dd>{formatMoney(p.refunded)}</dd>
            <dt>İade edilebilir</dt>
            <dd>
              <strong>{formatMoney(p.refundable)}</strong>
            </dd>
            <dt>Hizmet bedeli</dt>
            <dd>
              {formatMoney(p.platformFee)}
              {p.feeBps === null ? '' : ` (${formatBps(p.feeBps)})`}
            </dd>
            <dt>İş anlaşılan tutar</dt>
            <dd>{formatMoney(p.job.agreedPrice)}</dd>
            <dt>İş güncel toplam</dt>
            <dd>{formatMoney(p.job.currentTotal)}</dd>
          </dl>
        </div>
        <div className="card">
          <h2>Ödeme</h2>
          <dl>
            <dt>İş</dt>
            <dd>
              <Link href={`/jobs/${p.jobId}`}>{p.jobTitle}</Link>
            </dd>
            <dt>Müşteri</dt>
            <dd>{p.customerName}</dd>
            <dt>Usta</dt>
            <dd>{p.providerName}</dd>
            <dt>Yöntem</dt>
            <dd>{PAYMENT_METHOD_LABELS[p.method]}</dd>
            <dt>Sağlayıcı</dt>
            <dd>{p.gateway ?? '—'}</dd>
            <dt>Sağlayıcı referansı</dt>
            <dd>{p.gatewayReference ?? '—'}</dd>
            <dt>Oluşturuldu</dt>
            <dd>{formatDate(p.createdAt)}</dd>
            <dt>Defter kayıtları</dt>
            <dd>
              <Link href={`/finance/ledger?paymentId=${p.id}`}>Bu ödemenin kayıtları</Link>
            </dd>
          </dl>
        </div>
      </section>

      <section className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <h2 style={{ padding: `${spacing.md}px ${spacing.md}px 0` }}>Ödeme denemeleri</h2>
        {p.attempts.length === 0 ? (
          <p style={{ padding: spacing.md }}>Deneme yok.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Durum</th>
                <th>Hata kodu</th>
                <th>Başladı</th>
                <th>Bitti</th>
              </tr>
            </thead>
            <tbody>
              {p.attempts.map((a) => (
                <tr key={a.id}>
                  <td>{a.attemptNumber}</td>
                  <td>
                    <AttemptStatusPill status={a.status} />
                  </td>
                  <td>{a.failureCode ?? '—'}</td>
                  <td>{formatDate(a.createdAt)}</td>
                  <td>{formatDate(a.completedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Usta kazancı</h2>
        {p.earning ? (
          <dl>
            <dt>Durum</dt>
            <dd>
              <EarningStatusPill status={p.earning.status} />
            </dd>
            <dt>Brüt</dt>
            <dd>{formatMoney(p.earning.gross)}</dd>
            <dt>Hizmet bedeli</dt>
            <dd>
              {formatMoney(p.earning.platformFee)} ({formatBps(p.earning.feeBps)})
            </dd>
            <dt>Net</dt>
            <dd>{formatMoney(p.earning.net)}</dd>
            <dt>İadelerden usta payı</dt>
            <dd>{formatMoney(p.earning.refunded)}</dd>
            <dt>Bekleme bitişi</dt>
            <dd>{formatDate(p.earning.holdUntil)}</dd>
            <dt>Serbest bırakıldı</dt>
            <dd>{formatDate(p.earning.releasedAt)}</dd>
          </dl>
        ) : (
          <p style={{ color: colors.textSecondary }}>Bu ödeme için kazanç kaydı yok.</p>
        )}
      </section>

      <section className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <h2 style={{ padding: `${spacing.md}px ${spacing.md}px 0` }}>İadeler</h2>
        {p.refunds.length === 0 ? (
          <p style={{ padding: spacing.md }}>İade yok.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Tutar</th>
                <th>Hizmet bedeli payı</th>
                <th>Usta payı</th>
                <th>Durum</th>
                <th>Neden</th>
                <th>İç not</th>
                <th>İsteyen</th>
                <th>Tarih</th>
              </tr>
            </thead>
            <tbody>
              {p.refunds.map((r) => (
                <tr key={r.id}>
                  <td>{formatMoney(r.amount)}</td>
                  <td>{formatMoney(r.feePortion)}</td>
                  <td>{formatMoney(r.providerPortion)}</td>
                  <td>
                    <RefundStatusPill status={r.status} />
                    {r.failureCode ? (
                      <div style={{ color: colors.emergency, fontSize: 13 }}>{r.failureCode}</div>
                    ) : null}
                  </td>
                  <td>{REFUND_REASON_LABELS[r.reason]}</td>
                  <td style={{ whiteSpace: 'pre-wrap' }}>{r.internalNote ?? '—'}</td>
                  <td>{r.requestedBy ?? 'Sistem'}</td>
                  <td>
                    {formatDate(r.createdAt)}
                    {r.completedAt ? (
                      <div style={{ color: colors.textSecondary, fontSize: 13 }}>
                        Tamamlandı: {formatDate(r.completedAt)}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ display: 'grid', gap: spacing.md }}>
        <h2>Defter kayıtları</h2>
        {p.ledger.length === 0 ? (
          <p className="card">Bu ödeme için defter kaydı yok.</p>
        ) : (
          p.ledger.map((tx) => <LedgerTransaction key={tx.id} tx={tx} />)
        )}
      </section>

      <section className="card">
        <h2>Denetim kaydı</h2>
        {p.audit.length === 0 ? (
          <p style={{ color: colors.textSecondary }}>Kayıt yok.</p>
        ) : (
          <ul>
            {p.audit.map((a, i) => (
              <li key={i}>
                {formatDate(a.at)} · {a.action}
                {a.entityType ? ` (${a.entityType})` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
