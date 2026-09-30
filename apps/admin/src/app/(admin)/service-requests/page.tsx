import {
  adminServiceRequestListItemSchema,
  serviceCategorySchema,
  formatMoney,
  paginatedSchema,
  provinceSchema,
  serviceRequestStatusSchema,
} from '@ustago/validation';
import { colors, spacing } from '@ustago/ui';
import Link from 'next/link';
import { z } from 'zod';

import { RequestStatusPill, RequestTypePill } from '@/components/request-pills';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { formatDate, REQUEST_STATUS_LABELS, REQUEST_TYPE_LABELS } from '@/lib/labels';
import { filtersToQuery, parseServiceRequestFilters } from '@/lib/service-request-filters';

const STATUSES = serviceRequestStatusSchema.options;

export default async function ServiceRequestsPage(props: PageProps<'/service-requests'>) {
  const filters = parseServiceRequestFilters(await props.searchParams);
  const pageQuery = filtersToQuery(filters, filters.cursor ? { cursor: filters.cursor } : {});
  await requireAdmin(`/service-requests${pageQuery ? `?${pageQuery}` : ''}`);

  const [result, provinces, categories] = await Promise.all([
    apiRequest(`/admin/service-requests?${pageQuery ? `${pageQuery}&` : ''}limit=25`, {
      schema: paginatedSchema(adminServiceRequestListItemSchema),
    }),
    apiRequest('/locations/provinces', { schema: z.array(provinceSchema) }),
    apiRequest('/categories', { schema: z.array(serviceCategorySchema) }),
  ]);

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <h1>İş talepleri</h1>
      <form method="get" className="card filters" aria-label="Filtreler">
        <label>
          Durum
          <select name="status" defaultValue={filters.status ?? ''}>
            <option value="">Tümü</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {REQUEST_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tür
          <select name="type" defaultValue={filters.type ?? ''}>
            <option value="">Tümü</option>
            <option value="NOW">{REQUEST_TYPE_LABELS.NOW}</option>
            <option value="QUOTE">{REQUEST_TYPE_LABELS.QUOTE}</option>
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
                    {p.isActive ? '' : ' (kapalı)'}
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
        <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'end' }}>
          <button type="submit" className="btn btn-primary">
            Filtrele
          </button>
          <Link href="/service-requests" className="btn">
            Temizle
          </Link>
        </div>
      </form>

      {!result.ok ? (
        <p role="alert">{result.message}</p>
      ) : result.data.items.length === 0 ? (
        <p className="card">Bu filtrelere uyan talep yok.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Talep</th>
                <th>Tür</th>
                <th>Durum</th>
                <th>Konum</th>
                <th>Müşteri bütçesi</th>
                <th>Teklif</th>
                <th>Anlaşılan</th>
                <th>Oluşturuldu</th>
              </tr>
            </thead>
            <tbody>
              {result.data.items.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/service-requests/${r.id}`}>{r.title}</Link>
                    <div style={{ color: colors.textSecondary, fontSize: 13 }}>
                      {r.category.name} · {r.customer.name}
                    </div>
                  </td>
                  <td>
                    <RequestTypePill type={r.type} />
                  </td>
                  <td>
                    <RequestStatusPill status={r.status} />
                  </td>
                  <td>
                    {r.location.district.name} / {r.location.province.name}
                  </td>
                  <td>{r.budget ? formatMoney(r.budget) : 'Belirtilmedi'}</td>
                  <td>{r.quoteCount}</td>
                  <td>{r.agreedPrice ? formatMoney(r.agreedPrice) : '—'}</td>
                  <td>{formatDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.ok && result.data.nextCursor ? (
        <Link
          href={`/service-requests?${filtersToQuery(filters, { cursor: result.data.nextCursor })}`}
          className="btn"
        >
          Sonraki sayfa
        </Link>
      ) : null}
    </div>
  );
}
