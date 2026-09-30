import { formatMoney, reconciliationReportSchema } from '@ustago/validation';
import { colors, spacing } from '@ustago/ui';

import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { formatDate } from '@/lib/labels';

const CHECKED_LABELS = {
  payments: 'Ödeme',
  refunds: 'İade',
  payouts: 'Para çekme',
  cashSettlements: 'Nakit ödeme',
  earnings: 'Usta kazancı',
  ledgerTransactions: 'Defter kaydı',
} as const;

export default async function ReconciliationPage() {
  await requireAdmin('/finance/reconciliation');
  const result = await apiRequest('/admin/finance/reconciliation', {
    schema: reconciliationReportSchema,
  });

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <h1>Mutabakat</h1>
      <p style={{ color: colors.textSecondary }}>
        Salt okunur rapor: ödemeler, iadeler, para çekmeler ve nakit ödemeler defterle
        karşılaştırılır. Hiçbir şey otomatik düzeltilmez.
      </p>
      {!result.ok ? (
        <p role="alert">{result.message}</p>
      ) : (
        <>
          <section className="grid-2">
            <div className="card">
              <h2>Kontrol edilen kayıtlar</h2>
              <dl>
                {(Object.keys(CHECKED_LABELS) as (keyof typeof CHECKED_LABELS)[]).map((k) => (
                  <div key={k} style={{ display: 'contents' }}>
                    <dt>{CHECKED_LABELS[k]}</dt>
                    <dd>{result.data.checked[k]}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="card">
              <h2>Defter toplamları</h2>
              <dl>
                <dt>Borç</dt>
                <dd>{formatMoney(result.data.totals.debit)}</dd>
                <dt>Alacak</dt>
                <dd>{formatMoney(result.data.totals.credit)}</dd>
                <dt>Durum</dt>
                <dd>
                  {result.data.ledgerBalanced ? (
                    <span className="pill pill-success">Defter dengeli</span>
                  ) : (
                    <span className="pill pill-danger" role="alert">
                      Defter dengesiz
                    </span>
                  )}
                </dd>
                <dt>Rapor zamanı</dt>
                <dd>{formatDate(result.data.generatedAt)}</dd>
              </dl>
            </div>
          </section>

          {result.data.mismatches.length === 0 ? (
            <p className="card" style={{ color: colors.success }}>
              Uyumsuzluk bulunamadı.
            </p>
          ) : (
            <section className="card" style={{ padding: 0, overflowX: 'auto' }}>
              <h2 style={{ padding: `${spacing.md}px ${spacing.md}px 0`, color: colors.emergency }}>
                {result.data.mismatches.length} uyumsuzluk
              </h2>
              <table>
                <thead>
                  <tr>
                    <th>Tür</th>
                    <th>Kayıt</th>
                    <th>Açıklama</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.mismatches.map((m, i) => (
                    <tr key={`${m.entityId}-${i}`}>
                      <td>
                        <code>{m.kind}</code>
                      </td>
                      <td>
                        {m.entityType}
                        <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{m.entityId}</div>
                      </td>
                      <td>{m.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  );
}
