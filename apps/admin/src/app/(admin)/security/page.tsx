import { paginatedSchema, riskSignalTypeSchema } from '@ustago/validation';
import { spacing } from '@ustago/ui';
import Link from 'next/link';

import { RiskStatusPill } from '@/components/trust-pills';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { formatDate, RISK_SIGNAL_STATUS_LABELS, RISK_SIGNAL_TYPE_LABELS } from '@/lib/labels';
import { riskSignalSchema } from '@/lib/schemas';
import { filterQuery, parseRiskFilters, RISK_STATUS_FILTERS } from '@/lib/trust-filters';

import { ModerationForm } from '../moderation-form';
import { reviewRiskSignal } from '../trust-actions';

export default async function SecurityPage(props: PageProps<'/security'>) {
  const filters = parseRiskFilters(await props.searchParams);
  const own = { status: filters.status, type: filters.type, cursor: filters.cursor };
  await requireAdmin(`/security?${filterQuery(own)}`);

  const result = await apiRequest(`/admin/risk-signals?${filterQuery(own, { api: true })}`, {
    schema: paginatedSchema(riskSignalSchema),
  });

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <h1>Güvenlik: risk sinyalleri</h1>
      <p className="muted">
        Risk sinyalleri bir insanın incelemesi için toplanan kanıtlardır; sistem hiçbir hesabı
        bunlara göre otomatik kapatmaz. Gerekirse ustayı{' '}
        <Link href="/providers">usta sayfasından</Link> askıya alın. Yönetici yetkileri için{' '}
        <Link href="/permissions">Yetkiler</Link> sayfasına bakın.
      </p>
      <form method="get" className="card filters" aria-label="Filtreler">
        <label>
          Durum
          <select name="status" defaultValue={filters.status}>
            {RISK_STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {RISK_SIGNAL_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tür
          <select name="type" defaultValue={filters.type ?? ''}>
            <option value="">Tümü</option>
            {riskSignalTypeSchema.options.map((t) => (
              <option key={t} value={t}>
                {RISK_SIGNAL_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'end' }}>
          <button type="submit" className="btn btn-primary">
            Filtrele
          </button>
          <Link href="/security" className="btn">
            Temizle
          </Link>
        </div>
      </form>

      {!result.ok ? (
        <p role="alert">{result.message}</p>
      ) : result.data.items.length === 0 ? (
        <p className="card">Bu filtreye uyan sinyal yok.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Sinyal</th>
                <th>Kişi</th>
                <th>Görüldü</th>
                <th>Kanıt</th>
                <th>İnceleme</th>
              </tr>
            </thead>
            <tbody>
              {result.data.items.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{RISK_SIGNAL_TYPE_LABELS[s.type]}</strong>
                    <div>
                      <RiskStatusPill status={s.status} />
                    </div>
                    <div className="muted">{s.source}</div>
                  </td>
                  <td>
                    {s.subject ? (
                      <>
                        {s.subject.name}
                        <div className="muted">
                          <Link href={`/audit?actorId=${s.subject.id}`}>İşlemleri</Link>
                        </div>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {formatDate(s.lastSeenAt)}
                    <div className="muted">
                      İlk: {formatDate(s.firstSeenAt)} · {s.occurrences} kez
                    </div>
                  </td>
                  <td>
                    <code style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {JSON.stringify(s.evidence)}
                    </code>
                  </td>
                  <td style={{ minWidth: 240 }}>
                    {s.status === 'OPEN' ? (
                      <ModerationForm
                        action={reviewRiskSignal}
                        hidden={{ id: s.id }}
                        submitLabel="Kaydet"
                        label="Risk sinyalini incele"
                        doneMessage="Kaydedildi."
                      >
                        <select name="status" required defaultValue="" aria-label="Karar">
                          <option value="" disabled>
                            Karar seçin
                          </option>
                          <option value="REVIEWED">{RISK_SIGNAL_STATUS_LABELS.REVIEWED}</option>
                          <option value="DISMISSED">{RISK_SIGNAL_STATUS_LABELS.DISMISSED}</option>
                        </select>
                        <textarea
                          name="note"
                          required
                          minLength={3}
                          maxLength={1000}
                          rows={2}
                          placeholder="Not"
                          aria-label="İnceleme notu"
                        />
                      </ModerationForm>
                    ) : (
                      <>
                        {s.reviewedBy?.name ?? '—'}
                        {s.reviewNote ? <div className="muted">{s.reviewNote}</div> : null}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.ok && result.data.nextCursor ? (
        <Link
          href={`/security?${filterQuery(own, { cursor: result.data.nextCursor })}`}
          className="btn"
        >
          Sonraki sayfa
        </Link>
      ) : null}
    </div>
  );
}
