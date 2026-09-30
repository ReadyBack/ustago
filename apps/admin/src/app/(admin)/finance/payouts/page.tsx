import {
  adminFinanceSummarySchema,
  adminPayoutSchema,
  formatMoney,
  paginatedSchema,
  payoutStatusSchema,
} from '@ustago/validation';
import { colors, spacing } from '@ustago/ui';
import Link from 'next/link';

import { PayoutStatusPill } from '@/components/finance-pills';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { listFilterQuery, parsePayoutFilter } from '@/lib/finance';
import { formatDate, PAYOUT_RESOLVE_LABELS, PAYOUT_STATUS_LABELS } from '@/lib/labels';

import { ModerationForm } from '../../moderation-form';
import { decidePayout, resolvePayout, verifyPayoutDestination } from '../actions';

export default async function PayoutsPage(props: PageProps<'/finance/payouts'>) {
  const filter = parsePayoutFilter(await props.searchParams);
  const pageQuery = listFilterQuery('status', filter);
  await requireAdmin(`/finance/payouts${pageQuery ? `?${pageQuery}` : ''}`);

  const [result, summary] = await Promise.all([
    apiRequest(`/admin/finance/payouts?${listFilterQuery('status', filter, { api: true })}`, {
      schema: paginatedSchema(adminPayoutSchema),
    }),
    apiRequest('/admin/finance/summary?range=today', { schema: adminFinanceSummarySchema }),
  ]);
  const testMode = summary.ok && summary.data.testMode;

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <h1>Para çekme talepleri</h1>
      <form method="get" className="card filters" aria-label="Filtreler">
        <label>
          Durum
          <select name="status" defaultValue={filter.value ?? ''}>
            <option value="">Tümü</option>
            {payoutStatusSchema.options.map((s) => (
              <option key={s} value={s}>
                {PAYOUT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'end' }}>
          <button type="submit" className="btn btn-primary">
            Filtrele
          </button>
          <Link href="/finance/payouts" className="btn">
            Temizle
          </Link>
        </div>
      </form>
      <p style={{ color: colors.textSecondary }}>
        Onaylanan talep ödeme sağlayıcısına iletilir. İptal edilen ya da başarısız olan talebin
        tutarı ustanın kullanılabilir bakiyesine döner. IBAN yalnızca maskeli gösterilir.
      </p>

      {!result.ok ? (
        <p role="alert">{result.message}</p>
      ) : result.data.items.length === 0 ? (
        <p className="card">Bu filtreye uyan talep yok.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Usta</th>
                <th>Tutar</th>
                <th>Durum</th>
                <th>Hesap</th>
                <th>Tarih</th>
                <th>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {result.data.items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/providers/${p.providerId}`}>{p.providerName}</Link>
                  </td>
                  <td>
                    <strong>{formatMoney(p.amount)}</strong>
                  </td>
                  <td>
                    <PayoutStatusPill status={p.status} />
                    {p.failureCode ? (
                      <div style={{ color: colors.emergency, fontSize: 13 }}>{p.failureCode}</div>
                    ) : null}
                    {p.statusNote ? (
                      <div style={{ color: colors.textSecondary, fontSize: 13 }}>
                        {p.statusNote}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {p.destination.holderName}
                    <div style={{ fontFamily: 'monospace', fontSize: 13 }}>
                      {p.destination.maskedIban}
                    </div>
                    {p.destination.isTest ? (
                      <span className="pill pill-warning">Test hesabı</span>
                    ) : null}
                    {p.destination.verificationStatus === 'PENDING_VERIFICATION' ? (
                      <details style={{ marginTop: spacing.xs }}>
                        <summary style={{ cursor: 'pointer', fontSize: 13 }}>
                          Hesap doğrulama bekliyor
                        </summary>
                        <div style={{ marginTop: spacing.xs, minWidth: 220 }}>
                          <ModerationForm
                            action={verifyPayoutDestination}
                            hidden={{ id: p.destination.id }}
                            submitLabel="Hesabı doğrula"
                            label="Banka hesabını doğrula"
                            doneMessage="Hesap doğrulandı."
                          >
                            <textarea
                              name="note"
                              required
                              minLength={5}
                              maxLength={500}
                              rows={2}
                              placeholder="Nasıl doğrulandı? (zorunlu)"
                              aria-label="Doğrulama notu"
                            />
                          </ModerationForm>
                        </div>
                      </details>
                    ) : null}
                  </td>
                  <td>
                    {formatDate(p.createdAt)}
                    {p.paidAt ? (
                      <div style={{ color: colors.textSecondary, fontSize: 13 }}>
                        Ödendi: {formatDate(p.paidAt)}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <div className="actions" style={{ gap: spacing.sm }}>
                      {p.status === 'REQUESTED' ? (
                        <ModerationForm
                          action={decidePayout}
                          hidden={{ id: p.id, decision: 'approve' }}
                          submitLabel="Onayla"
                          tone="primary"
                          label="Para çekme talebini onayla"
                          doneMessage="Onaylandı."
                        />
                      ) : null}
                      {p.status === 'REQUESTED' || p.status === 'APPROVED' ? (
                        <ModerationForm
                          action={decidePayout}
                          hidden={{ id: p.id, decision: 'cancel' }}
                          submitLabel="İptal et"
                          tone="danger"
                          label="Para çekme talebini iptal et"
                          doneMessage="İptal edildi."
                        >
                          <textarea
                            name="note"
                            maxLength={500}
                            rows={2}
                            placeholder="Not (isteğe bağlı)"
                            aria-label="İptal notu"
                          />
                        </ModerationForm>
                      ) : null}
                      {p.status === 'NEEDS_RECONCILIATION' ? (
                        <ModerationForm
                          action={resolvePayout}
                          hidden={{ id: p.id }}
                          submitLabel="Sonucu kaydet"
                          tone="primary"
                          label="Sonucu bilinmeyen para çekmeyi kapat"
                          doneMessage="Sonuç kaydedildi."
                        >
                          <select name="outcome" required defaultValue="" aria-label="Sonuç">
                            <option value="" disabled>
                              Sağlayıcıdaki sonuç
                            </option>
                            {(['PAID', 'FAILED'] as const).map((o) => (
                              <option key={o} value={o}>
                                {PAYOUT_RESOLVE_LABELS[o]}
                              </option>
                            ))}
                          </select>
                          <textarea
                            name="note"
                            required
                            minLength={5}
                            maxLength={500}
                            rows={2}
                            placeholder="Sağlayıcıda nasıl kontrol edildi? (zorunlu)"
                            aria-label="Kontrol notu"
                          />
                          <span style={{ color: colors.textSecondary, fontSize: 13 }}>
                            Önce ödeme sağlayıcısında gerçek sonucu kontrol edin. Başarısız
                            seçilirse tutar ustanın bakiyesine döner.
                          </span>
                        </ModerationForm>
                      ) : null}
                      {testMode && p.status === 'PROCESSING' ? (
                        <ModerationForm
                          action={decidePayout}
                          hidden={{ id: p.id, decision: 'mark-paid' }}
                          submitLabel="TEST: Ödendi işaretle"
                          label="TEST: Ödendi işaretle"
                          doneMessage="Ödendi olarak işaretlendi."
                        />
                      ) : null}
                      {testMode && (p.status === 'APPROVED' || p.status === 'PROCESSING') ? (
                        <ModerationForm
                          action={decidePayout}
                          hidden={{ id: p.id, decision: 'mark-failed' }}
                          submitLabel="TEST: Başarısız işaretle"
                          tone="danger"
                          label="TEST: Başarısız işaretle"
                          doneMessage="Başarısız olarak işaretlendi."
                        />
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.ok && result.data.nextCursor ? (
        <Link
          href={`/finance/payouts?${listFilterQuery('status', filter, { cursor: result.data.nextCursor })}`}
          className="btn"
        >
          Sonraki sayfa
        </Link>
      ) : null}
    </div>
  );
}
