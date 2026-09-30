import { formatMoney, paginatedSchema, uuidSchema } from '@ustago/validation';
import { colors, spacing } from '@ustago/ui';
import Link from 'next/link';

import { RunStatusPill } from '@/components/trust-pills';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { formatDate, RECONCILIATION_TRIGGER_LABELS } from '@/lib/labels';
import { reconciliationRunSchema } from '@/lib/schemas';
import { filterQuery } from '@/lib/trust-filters';

import { ModerationForm } from '../../moderation-form';
import { runReconciliation } from '../../ops-actions';

export default async function ReconciliationRunsPage(
  props: PageProps<'/operations/reconciliation'>,
) {
  const raw = (await props.searchParams)['cursor'];
  const cursor = uuidSchema.safeParse(raw).success ? (raw as string) : undefined;
  await requireAdmin(`/operations/reconciliation${cursor ? `?cursor=${cursor}` : ''}`);

  const result = await apiRequest(
    `/admin/finance/reconciliation/runs?${filterQuery({ cursor }, { api: true })}`,
    { schema: paginatedSchema(reconciliationRunSchema) },
  );

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <h1>Mutabakat çalıştırmaları</h1>
      <p className="notice" role="note">
        <strong>Mutabakat hiçbir şeyi otomatik düzeltmez.</strong> Ödemeleri, iadeleri, para
        çekmeleri ve nakit ödemeleri defterle karşılaştırır, sonucu kaydeder ve uyumsuzluk varsa
        uyarı açar. Düzeltme her zaman bir yöneticinin elle, denetim kaydıyla yaptığı ayrı bir
        işlemdir.
      </p>

      <section className="card" style={{ maxWidth: 520 }}>
        <h2>Şimdi çalıştır</h2>
        <p className="muted" style={{ marginBottom: spacing.sm }}>
          Zamanlanmış çalıştırmaya ek olarak elle çalıştırır (finans yetkisi gerekir). Aynı anda
          yalnızca bir mutabakat çalışabilir.{' '}
          <Link href="/finance/reconciliation">Anlık rapor</Link>
        </p>
        <ModerationForm
          action={runReconciliation}
          hidden={{}}
          submitLabel="Mutabakatı çalıştır"
          tone="primary"
          label="Mutabakatı çalıştır"
          doneMessage="Mutabakat tamamlandı ve kaydedildi. Hiçbir kayıt değiştirilmedi."
        />
      </section>

      {!result.ok ? (
        <p role="alert">{result.message}</p>
      ) : result.data.items.length === 0 ? (
        <p className="card">Henüz çalıştırma yok.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Başladı</th>
                <th>Tür</th>
                <th>Durum</th>
                <th>Sonuç</th>
                <th>Defter</th>
              </tr>
            </thead>
            <tbody>
              {result.data.items.map((r) => (
                <tr key={r.id}>
                  <td>
                    {formatDate(r.startedAt)}
                    {r.durationMs !== null ? (
                      <div className="muted">{(r.durationMs / 1000).toFixed(1)} sn</div>
                    ) : null}
                  </td>
                  <td>{RECONCILIATION_TRIGGER_LABELS[r.trigger]}</td>
                  <td>
                    <RunStatusPill status={r.status} />
                    {r.error ? (
                      <div style={{ color: colors.emergency, fontSize: 13 }}>
                        <code>{r.error}</code>
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {r.status !== 'SUCCEEDED' ? (
                      '—'
                    ) : r.mismatchCount === 0 && r.snapshotMismatchCount === 0 ? (
                      <span style={{ color: colors.success }}>Uyumsuzluk yok</span>
                    ) : (
                      <details>
                        <summary style={{ cursor: 'pointer', color: colors.emergency }}>
                          {r.mismatchCount} uyumsuzluk
                          {r.snapshotMismatchCount > 0
                            ? `, ${r.snapshotMismatchCount} komisyon kaydı uyumsuz`
                            : ''}
                        </summary>
                        <ul style={{ marginTop: spacing.xs }}>
                          {r.mismatches.map((m, i) => (
                            <li key={`${m.entityId}-${i}`}>
                              <code>{m.kind}</code> · {m.entityType}{' '}
                              <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
                                {m.entityId}
                              </span>
                              : {m.message}
                            </li>
                          ))}
                        </ul>
                        {r.alertId ? <Link href="/operations/alerts">İlgili uyarı</Link> : null}
                      </details>
                    )}
                    <div className="muted">{r.snapshotsChecked} komisyon kaydı kontrol edildi</div>
                  </td>
                  <td>
                    {r.totals ? (
                      <>
                        Borç {formatMoney(r.totals.debit)}
                        <div>Alacak {formatMoney(r.totals.credit)}</div>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.ok && result.data.nextCursor ? (
        <Link href={`/operations/reconciliation?cursor=${result.data.nextCursor}`} className="btn">
          Sonraki sayfa
        </Link>
      ) : null}
    </div>
  );
}
