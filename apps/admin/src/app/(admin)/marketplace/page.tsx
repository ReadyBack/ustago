import { colors, spacing } from '@ustago/ui';
import Link from 'next/link';

import { ApiErrorNotice } from '@/components/api-error';
import { PeriodPicker } from '@/components/period-picker';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import {
  formatCount,
  formatMinutes,
  formatPercent,
  funnelRows,
  parsePeriod,
} from '@/lib/marketplace';
import { marketplaceOverviewSchema } from '@/lib/marketplace-schemas';

export default async function MarketplaceOverviewPage(props: PageProps<'/marketplace'>) {
  const days = parsePeriod((await props.searchParams).days, 7);
  await requireAdmin(`/marketplace?days=${days}`);
  const result = await apiRequest(`/admin/marketplace/overview?days=${days}`, {
    schema: marketplaceOverviewSchema,
  });

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <header style={{ display: 'grid', gap: spacing.sm }}>
        <h1>Pazar yeri: genel bakış</h1>
        <PeriodPicker basePath="/marketplace" current={days} />
      </header>

      {!result.ok ? (
        <ApiErrorNotice error={result} what="Pazar yeri özeti" />
      ) : (
        <Overview data={result.data} />
      )}
    </div>
  );
}

type OverviewData = Extract<
  Awaited<ReturnType<typeof apiRequest<typeof marketplaceOverviewSchema>>>,
  { ok: true }
>['data'];

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card stat">
      <span className="stat-value">{value}</span>
      <span style={{ color: colors.textSecondary }}>{label}</span>
      {hint ? <span className="muted">{hint}</span> : null}
    </div>
  );
}

function Overview({ data }: { data: OverviewData }) {
  const funnel = funnelRows(data.funnel);
  const period = `son ${data.periodDays} gün`;
  return (
    <>
      <section style={{ display: 'grid', gap: spacing.md }}>
        <h2>Bugün</h2>
        <div className="kpi-grid">
          <Kpi label="Bugün gelen talep" value={formatCount(data.today.requestsCreated)} />
          <Kpi label="Bugün verilen teklif" value={formatCount(data.today.quotes)} />
          <Kpi label="Bugün tamamlanan iş" value={formatCount(data.today.jobsCompleted)} />
          <Link href="/marketplace/no-offer" className="card stat">
            <span className="stat-value">{formatCount(data.noOfferOpenRequests)}</span>
            <span style={{ color: colors.textSecondary }}>Teklifsiz açık talep</span>
          </Link>
          <Kpi label="Aktif usta" value={formatCount(data.activeProviders)} />
          <Kpi label="Şu an müsait usta" value={formatCount(data.availableProviders)} />
        </div>
      </section>

      <section style={{ display: 'grid', gap: spacing.md }}>
        <h2>Oranlar ({period})</h2>
        <div className="kpi-grid">
          <Kpi label="Teklif alma oranı" value={formatPercent(data.quoteRatePercent)} />
          <Kpi label="Kabul oranı" value={formatPercent(data.acceptanceRatePercent)} />
          <Kpi label="Tamamlanma oranı" value={formatPercent(data.completionRatePercent)} />
          <Kpi
            label="İlk teklife kadar geçen süre (medyan)"
            value={formatMinutes(data.medianFirstQuoteMinutes)}
          />
        </div>
        <p className="muted">“—”: bu dönemde oranı hesaplayacak kadar kayıt yok (payda sıfır).</p>
      </section>

      <section className="card" style={{ display: 'grid', gap: spacing.md }}>
        <h2>Talep hunisi ({period})</h2>
        {funnel.length === 0 || funnel.every((s) => s.requests === 0) ? (
          <p>Bu dönemde talep yok.</p>
        ) : (
          <ol className="funnel" aria-label="Talep hunisi">
            {funnel.map((step, i) => (
              <li key={step.key}>
                <span className="funnel-label">{step.label}</span>
                <span className="funnel-track" aria-hidden="true">
                  <span className="funnel-bar" style={{ width: `${step.barPercent}%` }} />
                </span>
                <span className="funnel-value">
                  <strong>{formatCount(step.requests)}</strong>
                  {i > 0 ? (
                    <span className="muted">
                      {' '}
                      · önceki adımın {formatPercent(step.fromPreviousPercent)}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="muted">
          Her adım, dönem içinde o adıma ulaşan farklı talep sayısıdır. Oranlar bir önceki adıma
          göredir.
        </p>
      </section>

      <section className="card" style={{ display: 'grid', gap: spacing.md }}>
        <h2>Arama ({period})</h2>
        <dl>
          <dt>Arama</dt>
          <dd>{formatCount(data.search.searches)}</dd>
          <dt>Sonuçsuz arama</dt>
          <dd>
            {formatCount(data.search.noResult)}
            {data.search.searches > 0 ? (
              <span className="muted">
                {' '}
                (
                {formatPercent(
                  Math.round((data.search.noResult / data.search.searches) * 1000) / 10,
                )}
                )
              </span>
            ) : null}
          </dd>
        </dl>
        <h3>En çok sonuçsuz kalan aramalar</h3>
        {data.search.topNoResultQueries.length === 0 ? (
          <p className="muted">Sonuçsuz arama yok.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Arama</th>
                <th>Sayı</th>
              </tr>
            </thead>
            <tbody>
              {data.search.topNoResultQueries.map((q) => (
                <tr key={q.query}>
                  <td>{q.query}</td>
                  <td>{formatCount(q.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted">
          Arama metinleri API tarafından kişisel bilgilerden arındırılmış olarak gelir. Yeni bir eş
          anlamlı ifade eklemek için <Link href="/categories">kategori içeriklerine</Link> bakın.
        </p>
      </section>
      <p className="muted">“Bugün” {data.timeZone} saatine göre hesaplanır.</p>
    </>
  );
}
