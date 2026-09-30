import { spacing } from '@ustago/ui';
import Link from 'next/link';
import { z } from 'zod';

import { ApiErrorNotice } from '@/components/api-error';
import { PeriodPicker } from '@/components/period-picker';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { formatCount, formatMedianPrice, formatPercent, parsePeriod } from '@/lib/marketplace';
import { categoryStatsSchema } from '@/lib/marketplace-schemas';

export default async function CategoryStatsPage(props: PageProps<'/marketplace/categories'>) {
  const days = parsePeriod((await props.searchParams).days, 30);
  await requireAdmin(`/marketplace/categories?days=${days}`);
  const result = await apiRequest(`/admin/marketplace/categories?days=${days}`, {
    schema: z.array(categoryStatsSchema),
  });

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <header style={{ display: 'grid', gap: spacing.sm }}>
        <h1>Kategori analitiği</h1>
        <PeriodPicker basePath="/marketplace/categories" current={days} />
      </header>
      <p className="muted">
        Medyan fiyat yalnızca tamamlanmış işlerin anlaşılan fiyatından hesaplanır; örnek sayısı
        yetersizse “Yetersiz veri” gösterilir. Oranlarda payda sıfırsa “—” gösterilir.
      </p>

      {!result.ok ? (
        <ApiErrorNotice error={result} what="Kategori istatistikleri" />
      ) : result.data.length === 0 ? (
        <p className="card">Bu dönem için kategori verisi yok.</p>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kategori</th>
                <th className="num">Talep</th>
                <th className="num">Teklif</th>
                <th className="num">Kabul oranı</th>
                <th className="num">Tamamlanma oranı</th>
                <th className="num">Medyan fiyat</th>
                <th className="num">Aktif usta</th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((row) => (
                <tr key={row.category.id}>
                  <td>
                    <Link href={`/categories/${row.category.id}`}>{row.category.name}</Link>
                  </td>
                  <td className="num">{formatCount(row.requests)}</td>
                  <td className="num">{formatCount(row.quotes)}</td>
                  <td className="num">{formatPercent(row.acceptanceRatePercent)}</td>
                  <td className="num">{formatPercent(row.completionRatePercent)}</td>
                  <td className="num">{formatMedianPrice(row.medianPriceMinor)}</td>
                  <td className="num">{formatCount(row.activeProviders)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
