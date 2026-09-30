import type { MatchBreakdownLine } from '@ustago/types';
import { colors, spacing } from '@ustago/ui';
import Link from 'next/link';

import { ApiErrorNotice } from '@/components/api-error';
import { apiRequest } from '@/lib/api';
import {
  DISPATCH_RESULT_LABELS,
  formatDate,
  labelOf,
  MARKETPLACE_EVENT_LABELS,
  NOTIFY_MODE_LABELS,
} from '@/lib/labels';
import { formatDistanceKm } from '@/lib/marketplace';
import { adminDispatchTimelineSchema, adminMatchPreviewSchema } from '@/lib/marketplace-schemas';

const scoreFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
const RESULT_TONE = { PENDING: 'neutral', QUOTED: 'success', CLOSED: 'warning' } as const;

const RANKING_NOTE =
  'Puan, talebin kimlere hangi sırayla gönderildiğini açıklar; ustanın kalitesi hakkında bir karar değildir.';

/** Score and its breakdown lines behind a disclosure. */
function Score({ score, breakdown }: { score: number; breakdown: MatchBreakdownLine[] }) {
  const title = breakdown.map((b) => `${b.label}: ${scoreFormat.format(b.points)}`).join('\n');
  if (breakdown.length === 0) return <strong>{scoreFormat.format(score)}</strong>;
  return (
    <details>
      <summary title={title}>
        <strong>{scoreFormat.format(score)}</strong>
      </summary>
      <ul style={{ fontSize: 13, marginTop: 4 }}>
        {breakdown.map((b) => (
          <li key={b.key}>
            {b.label}: {b.points > 0 ? '+' : ''}
            {scoreFormat.format(b.points)}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** "Dağıtım": waves, per-provider rows and the marketplace event timeline. */
export async function DispatchSection({ requestId }: { requestId: string }) {
  const result = await apiRequest(`/admin/service-requests/${requestId}/dispatch`, {
    schema: adminDispatchTimelineSchema,
  });

  return (
    <section style={{ display: 'grid', gap: spacing.md }}>
      <h2>Dağıtım</h2>
      {!result.ok ? (
        <ApiErrorNotice error={result} what="Dağıtım zaman çizelgesi" />
      ) : (
        <>
          <div className="card">
            <dl>
              <dt>Güncel dalga</dt>
              <dd>{result.data.wave}</dd>
              <dt>Sonraki dağıtım</dt>
              <dd>{result.data.nextDispatchAt ? formatDate(result.data.nextDispatchAt) : '—'}</dd>
              <dt>Gönderilen usta</dt>
              <dd>{result.data.rows.length}</dd>
            </dl>
            <p className="muted" style={{ marginTop: spacing.sm }}>
              {RANKING_NOTE} Mesafe yaklaşıktır.
            </p>
          </div>

          {result.data.rows.length === 0 ? (
            <p className="card">Bu talep henüz hiçbir ustaya gönderilmedi.</p>
          ) : (
            <div className="card table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Dalga</th>
                    <th>Usta</th>
                    <th>Eşleşme puanı</th>
                    <th>Mesafe</th>
                    <th>Bildirim</th>
                    <th>Gönderildi</th>
                    <th>Görüldü</th>
                    <th>Yanıt</th>
                    <th>Sonuç</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.rows.map((row) => (
                    <tr key={`${row.wave}-${row.providerId}`}>
                      <td>{row.wave}</td>
                      <td>
                        <Link href={`/providers/${row.providerId}`}>{row.providerName}</Link>
                        {row.isPreferred ? (
                          <span className="pill pill-neutral" style={{ marginLeft: 6 }}>
                            Müşterinin tercihi
                          </span>
                        ) : null}
                        <div className="muted">Algoritma {row.algorithmVersion}</div>
                      </td>
                      <td>
                        <Score score={row.matchScore} breakdown={row.breakdown} />
                      </td>
                      <td>{formatDistanceKm(row.distanceKm)}</td>
                      <td>{NOTIFY_MODE_LABELS[row.notifyMode]}</td>
                      <td>{formatDate(row.dispatchedAt)}</td>
                      <td>{formatDate(row.viewedAt)}</td>
                      <td>{formatDate(row.respondedAt)}</td>
                      <td>
                        <span className={`pill pill-${RESULT_TONE[row.result]}`}>
                          {DISPATCH_RESULT_LABELS[row.result]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="card">
            <h3>Pazar yeri olayları</h3>
            {result.data.events.length === 0 ? (
              <p className="muted">Kayıtlı olay yok.</p>
            ) : (
              <ol style={{ display: 'grid', gap: 4, paddingLeft: 20 }}>
                {result.data.events.map((e, i) => (
                  <li key={`${e.type}-${e.occurredAt}-${i}`}>
                    <span style={{ color: colors.textSecondary }}>{formatDate(e.occurredAt)}</span>{' '}
                    · {labelOf(MARKETPLACE_EVENT_LABELS, e.type)}
                    {e.providerId ? (
                      <>
                        {' '}
                        · <Link href={`/providers/${e.providerId}`}>ilgili usta</Link>
                      </>
                    ) : null}
                    {e.value !== null ? <span className="muted"> · değer: {e.value}</span> : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * "Eşleştirme önizleme" (debug): who the ranking would pick right now. Runs
 * only when asked (`?preview=1`) because it computes the ranking live.
 */
export async function MatchPreviewSection({
  requestId,
  enabled,
}: {
  requestId: string;
  enabled: boolean;
}) {
  return (
    <section className="card" style={{ display: 'grid', gap: spacing.md }}>
      <h2>Eşleştirme önizleme</h2>
      <p className="muted">
        Hata ayıklama aracıdır: sıralama algoritmasının bu talep için şu an kimi, hangi puanla
        seçeceğini gösterir. {RANKING_NOTE} Doğrulama rozeti kaliteyle aynı şey değildir.
      </p>
      {enabled ? (
        <MatchPreview requestId={requestId} />
      ) : (
        <div>
          <Link href={`/service-requests/${requestId}?preview=1#eslestirme`} className="btn">
            Önizlemeyi çalıştır
          </Link>
        </div>
      )}
    </section>
  );
}

async function MatchPreview({ requestId }: { requestId: string }) {
  const result = await apiRequest(`/admin/marketplace/match-preview?requestId=${requestId}`, {
    schema: adminMatchPreviewSchema,
  });
  if (!result.ok) return <ApiErrorNotice error={result} what="Eşleştirme önizlemesi" />;
  const p = result.data;
  return (
    <>
      <p>
        Algoritma sürümü <strong>{p.algorithmVersion}</strong> · hesaplama süresi{' '}
        <strong>{scoreFormat.format(p.durationMs)} ms</strong> · {p.candidates.length} aday
      </p>
      {p.candidates.length === 0 ? (
        <p>Uygun aday yok.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Usta</th>
                <th>Puan</th>
                <th>Mesafe</th>
                <th>Durum</th>
              </tr>
            </thead>
            <tbody>
              {p.candidates.map((c, i) => (
                <tr key={c.providerId}>
                  <td>{i + 1}</td>
                  <td>
                    <Link href={`/providers/${c.providerId}`}>{c.providerName}</Link>
                  </td>
                  <td>
                    <Score score={c.score} breakdown={c.breakdown} />
                  </td>
                  <td>{formatDistanceKm(c.distanceKm)}</td>
                  <td>{c.alreadyDispatched ? 'Zaten gönderildi' : 'Henüz gönderilmedi'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
