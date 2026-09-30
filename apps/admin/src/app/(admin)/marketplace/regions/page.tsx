import { REGION_PRIVACY_THRESHOLD } from '@ustago/validation';
import { spacing } from '@ustago/ui';
import Link from 'next/link';
import { z } from 'zod';

import { ApiErrorNotice } from '@/components/api-error';
import { LaunchStatusPill } from '@/components/launch-status-pill';
import { PeriodPicker } from '@/components/period-picker';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import {
  formatCount,
  formatPrivateCount,
  formatRatio,
  parsePeriod,
  parseProvinceId,
  regionName,
} from '@/lib/marketplace';
import { regionStatsSchema } from '@/lib/marketplace-schemas';

export default async function RegionsPage(props: PageProps<'/marketplace/regions'>) {
  const params = await props.searchParams;
  const days = parsePeriod(params.days, 30);
  const provinceId = parseProvinceId(params.provinceId);
  const query = `days=${days}${provinceId ? `&provinceId=${provinceId}` : ''}`;
  await requireAdmin(`/marketplace/regions?${query}`);

  const result = await apiRequest(`/admin/marketplace/regions?${query}`, {
    schema: z.array(regionStatsSchema),
  });
  const provinceName = result.ok ? result.data[0]?.province.name : undefined;

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <header style={{ display: 'grid', gap: spacing.sm }}>
        {provinceId ? <Link href={`/marketplace/regions?days=${days}`}>← Tüm iller</Link> : null}
        <h1>
          Arz ve talep: {provinceId ? `${provinceName ?? `İl ${provinceId}`} ilçeleri` : 'iller'}
        </h1>
        <PeriodPicker
          basePath="/marketplace/regions"
          current={days}
          params={{ provinceId: provinceId ? String(provinceId) : undefined }}
        />
      </header>
      <p className="muted">
        Talep, teklif, tamamlanan iş ve karşılanmayan talep sayıları {REGION_PRIVACY_THRESHOLD}
        ’ten azsa gizlilik için “&lt;{REGION_PRIVACY_THRESHOLD}” gösterilir. Usta başına talep,
        müsait usta yoksa “—” olur. Karşılanmayan talep: hiçbir ustaya gönderilemeyen (arz olmayan)
        talepler. İlin açılış durumunu <Link href="/marketplace/provinces">İl açılışları</Link>{' '}
        sayfasından değiştirebilirsiniz.
      </p>

      {!result.ok ? (
        <ApiErrorNotice error={result} what="Bölge istatistikleri" />
      ) : result.data.length === 0 ? (
        <p className="card">Bu dönem için bölge verisi yok.</p>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>{provinceId ? 'İlçe' : 'İl'}</th>
                <th className="num">Talep</th>
                <th className="num">Teklif</th>
                <th className="num">Tamamlanan iş</th>
                <th className="num">Aktif usta</th>
                <th className="num">Müsait usta</th>
                <th className="num">Usta başına talep</th>
                <th className="num">Karşılanmayan talep</th>
                <th>Açılış durumu</th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((row) => (
                <tr key={row.district ? row.district.id : `p-${row.province.id}`}>
                  <td>
                    {provinceId ? (
                      regionName(row)
                    ) : (
                      <Link
                        href={`/marketplace/regions?days=${days}&provinceId=${row.province.id}`}
                      >
                        {regionName(row)}
                      </Link>
                    )}
                  </td>
                  <td className="num">{formatPrivateCount(row.requests)}</td>
                  <td className="num">{formatPrivateCount(row.quotes)}</td>
                  <td className="num">{formatPrivateCount(row.completedJobs)}</td>
                  <td className="num">{formatCount(row.activeProviders)}</td>
                  <td className="num">{formatCount(row.availableProviders)}</td>
                  <td className="num">{formatRatio(row.demandPerProvider)}</td>
                  <td className="num">{formatPrivateCount(row.unservedRequests)}</td>
                  <td>
                    <LaunchStatusPill status={row.launchStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
