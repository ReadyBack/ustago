import {
  adminJobListItemSchema,
  formatMoney,
  jobStatusSchema,
  paginatedSchema,
  provinceSchema,
  serviceCategorySchema,
} from '@ustago/validation';
import { colors, spacing } from '@ustago/ui';
import Link from 'next/link';
import { z } from 'zod';

import { JobStatusPill } from '@/components/job-pills';
import { RequestTypePill } from '@/components/request-pills';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { jobFiltersToApiQuery, jobFiltersToQuery, parseJobFilters } from '@/lib/job-filters';
import { formatDate, JOB_STATUS_LABELS } from '@/lib/labels';

const STATUSES = jobStatusSchema.options;

export default async function JobsPage(props: PageProps<'/jobs'>) {
  const filters = parseJobFilters(await props.searchParams);
  const pageQuery = jobFiltersToQuery(filters, filters.cursor ? { cursor: filters.cursor } : {});
  await requireAdmin(`/jobs${pageQuery ? `?${pageQuery}` : ''}`);

  const [result, provinces, categories] = await Promise.all([
    apiRequest(`/admin/jobs?${jobFiltersToApiQuery(filters)}`, {
      schema: paginatedSchema(adminJobListItemSchema),
    }),
    apiRequest('/locations/provinces', { schema: z.array(provinceSchema) }),
    apiRequest('/categories', { schema: z.array(serviceCategorySchema) }),
  ]);

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <h1>İşler</h1>
      <form method="get" className="card filters" aria-label="Filtreler">
        {filters.providerId ? (
          <input type="hidden" name="providerId" value={filters.providerId} />
        ) : null}
        {filters.customerId ? (
          <input type="hidden" name="customerId" value={filters.customerId} />
        ) : null}
        <label>
          Durum
          <select name="status" defaultValue={filters.status ?? ''}>
            <option value="">Tümü</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {JOB_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          İl
          <select name="provinceId" defaultValue={filters.provinceId?.toString() ?? ''}>
            <option value="">Tümü</option>
            {provinces.ok
              ? provinces.data.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))
              : null}
          </select>
        </label>
        <label>
          Kategori
          <select name="categoryId" defaultValue={filters.categoryId ?? ''}>
            <option value="">Tümü</option>
            {categories.ok
              ? categories.data.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))
              : null}
          </select>
        </label>
        <label>
          Başlangıç
          <input type="date" name="from" defaultValue={filters.from ?? ''} />
        </label>
        <label>
          Bitiş
          <input type="date" name="to" defaultValue={filters.to ?? ''} />
        </label>
        <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'end' }}>
          <button type="submit" className="btn btn-primary">
            Filtrele
          </button>
          <Link href="/jobs" className="btn">
            Temizle
          </Link>
        </div>
      </form>
      {filters.providerId || filters.customerId ? (
        <p style={{ color: colors.textSecondary }}>
          {filters.providerId ? 'Tek bir ustanın işleri gösteriliyor. ' : ''}
          {filters.customerId ? 'Tek bir müşterinin işleri gösteriliyor. ' : ''}
          <Link href="/jobs">Tüm işler</Link>
        </p>
      ) : null}

      {!result.ok ? (
        <p role="alert">{result.message}</p>
      ) : result.data.items.length === 0 ? (
        <p className="card">Bu filtrelere uyan iş yok.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>İş</th>
                <th>Tür</th>
                <th>Durum</th>
                <th>Usta</th>
                <th>Konum</th>
                <th>Anlaşılan</th>
                <th>Güncel toplam</th>
                <th>Oluşturuldu</th>
              </tr>
            </thead>
            <tbody>
              {result.data.items.map((j) => (
                <tr key={j.id}>
                  <td>
                    <Link href={`/jobs/${j.id}`}>{j.title}</Link>
                    <div style={{ color: colors.textSecondary, fontSize: 13 }}>
                      {j.category.name} · {j.customer.name}
                    </div>
                  </td>
                  <td>
                    <RequestTypePill type={j.requestType} />
                  </td>
                  <td>
                    <JobStatusPill status={j.status} />
                  </td>
                  <td>
                    <Link href={`/providers/${j.provider.id}`}>{j.provider.displayName}</Link>
                  </td>
                  <td>
                    {j.location.district.name} / {j.location.province.name}
                  </td>
                  <td>{formatMoney(j.agreedPrice)}</td>
                  <td>
                    {j.currentTotal.amountMinor === j.agreedPrice.amountMinor ? (
                      formatMoney(j.currentTotal)
                    ) : (
                      <strong>{formatMoney(j.currentTotal)}</strong>
                    )}
                  </td>
                  <td>{formatDate(j.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.ok && result.data.nextCursor ? (
        <Link
          href={`/jobs?${jobFiltersToQuery(filters, { cursor: result.data.nextCursor })}`}
          className="btn"
        >
          Sonraki sayfa
        </Link>
      ) : null}
    </div>
  );
}
