import { paginatedSchema } from '@ustago/validation';
import { spacing } from '@ustago/ui';
import Link from 'next/link';

import { AlertSeverityPill, AlertStatusPill } from '@/components/trust-pills';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { ALERT_SEVERITY_LABELS, ALERT_STATUS_LABELS, formatDate } from '@/lib/labels';
import { operationalAlertSchema } from '@/lib/schemas';
import {
  ALERT_SEVERITY_FILTERS,
  ALERT_STATUS_FILTERS,
  filterQuery,
  parseAlertFilters,
} from '@/lib/trust-filters';

import { ModerationForm } from '../../moderation-form';
import { acknowledgeAlert, resolveAlert } from '../../ops-actions';

export default async function AlertsPage(props: PageProps<'/operations/alerts'>) {
  const filters = parseAlertFilters(await props.searchParams);
  const own = { status: filters.status, severity: filters.severity, cursor: filters.cursor };
  await requireAdmin(`/operations/alerts?${filterQuery(own)}`);

  const result = await apiRequest(`/admin/alerts?${filterQuery(own, { api: true })}`, {
    schema: paginatedSchema(operationalAlertSchema),
  });

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <h1>Uyarılar</h1>
      <p className="muted">
        Uyarılar yalnızca bilgi verir: “İlgileniyorum” ekibe sizin baktığınızı gösterir, “Kapat” not
        ile kapatır. Hiçbiri finans kayıtlarını değiştirmez. Aynı sorun tekrar ederse uyarı yeniden
        açılır.
      </p>
      <form method="get" className="card filters" aria-label="Filtreler">
        <label>
          Durum
          <select name="status" defaultValue={filters.status}>
            {ALERT_STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {ALERT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Önem
          <select name="severity" defaultValue={filters.severity ?? ''}>
            <option value="">Tümü</option>
            {ALERT_SEVERITY_FILTERS.map((s) => (
              <option key={s} value={s}>
                {ALERT_SEVERITY_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'end' }}>
          <button type="submit" className="btn btn-primary">
            Filtrele
          </button>
          <Link href="/operations/alerts" className="btn">
            Temizle
          </Link>
        </div>
      </form>

      {!result.ok ? (
        <p role="alert">{result.message}</p>
      ) : result.data.items.length === 0 ? (
        <p className="card">Bu filtreye uyan uyarı yok.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Uyarı</th>
                <th>Durum</th>
                <th>Görüldü</th>
                <th>Ayrıntı</th>
                <th>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {result.data.items.map((a) => (
                <tr key={a.id}>
                  <td>
                    <AlertSeverityPill severity={a.severity} /> <strong>{a.title}</strong>
                    <div className="muted">
                      <code>{a.type}</code> · {a.source}
                    </div>
                  </td>
                  <td>
                    <AlertStatusPill status={a.status} />
                    {a.acknowledgedBy ? (
                      <div className="muted">
                        İlgilenen: {a.acknowledgedBy.name} · {formatDate(a.acknowledgedAt)}
                      </div>
                    ) : null}
                    {a.resolvedBy ? (
                      <div className="muted">
                        Kapatan: {a.resolvedBy.name} · {formatDate(a.resolvedAt)}
                      </div>
                    ) : null}
                    {a.resolutionNote ? <div>{a.resolutionNote}</div> : null}
                  </td>
                  <td>
                    {formatDate(a.lastSeenAt)}
                    <div className="muted">
                      İlk: {formatDate(a.firstSeenAt)} · {a.occurrences} kez
                    </div>
                  </td>
                  <td>
                    {Object.keys(a.details).length > 0 ? (
                      <code
                        style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                      >
                        {JSON.stringify(a.details)}
                      </code>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td style={{ minWidth: 240 }}>
                    <div style={{ display: 'grid', gap: spacing.sm }}>
                      {a.status === 'OPEN' ? (
                        <ModerationForm
                          action={acknowledgeAlert}
                          hidden={{ id: a.id }}
                          submitLabel="İlgileniyorum"
                          label="Uyarıyla ilgileniyorum"
                        />
                      ) : null}
                      {a.status !== 'RESOLVED' ? (
                        <ModerationForm
                          action={resolveAlert}
                          hidden={{ id: a.id }}
                          submitLabel="Kapat"
                          tone="primary"
                          label="Uyarıyı kapat"
                        >
                          <textarea
                            name="note"
                            required
                            minLength={5}
                            maxLength={1000}
                            rows={2}
                            placeholder="Ne yapıldı? (zorunlu)"
                            aria-label="Kapatma notu"
                          />
                        </ModerationForm>
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
          href={`/operations/alerts?${filterQuery(own, { cursor: result.data.nextCursor })}`}
          className="btn"
        >
          Sonraki sayfa
        </Link>
      ) : null}
    </div>
  );
}
