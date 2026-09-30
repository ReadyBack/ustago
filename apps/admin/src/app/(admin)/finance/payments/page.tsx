import {
  adminPaymentListItemSchema,
  formatMoney,
  paginatedSchema,
  paymentMethodChoiceSchema,
  paymentStatusSchema,
} from '@ustago/validation';
import { colors, spacing } from '@ustago/ui';
import Link from 'next/link';

import { PaymentStatusPill } from '@/components/finance-pills';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import {
  parsePaymentFilters,
  paymentFiltersToApiQuery,
  paymentFiltersToQuery,
} from '@/lib/finance';
import { formatDate, PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS } from '@/lib/labels';

export default async function PaymentsPage(props: PageProps<'/finance/payments'>) {
  const filters = parsePaymentFilters(await props.searchParams);
  const pageQuery = paymentFiltersToQuery(
    filters,
    filters.cursor ? { cursor: filters.cursor } : {},
  );
  await requireAdmin(`/finance/payments${pageQuery ? `?${pageQuery}` : ''}`);

  const result = await apiRequest(`/admin/finance/payments?${paymentFiltersToApiQuery(filters)}`, {
    schema: paginatedSchema(adminPaymentListItemSchema),
  });

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <h1>Ödemeler</h1>
      <form method="get" className="card filters" aria-label="Filtreler">
        <label>
          Durum
          <select name="status" defaultValue={filters.status ?? ''}>
            <option value="">Tümü</option>
            {paymentStatusSchema.options.map((s) => (
              <option key={s} value={s}>
                {PAYMENT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Yöntem
          <select name="method" defaultValue={filters.method ?? ''}>
            <option value="">Tümü</option>
            {paymentMethodChoiceSchema.options.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
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
          <Link href="/finance/payments" className="btn">
            Temizle
          </Link>
        </div>
      </form>

      {!result.ok ? (
        <p role="alert">{result.message}</p>
      ) : result.data.items.length === 0 ? (
        <p className="card">Bu filtrelere uyan ödeme yok.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>İş</th>
                <th>Durum</th>
                <th>Yöntem</th>
                <th>Tutar</th>
                <th>İade</th>
                <th>Müşteri / Usta</th>
                <th>Tarih</th>
              </tr>
            </thead>
            <tbody>
              {result.data.items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/finance/payments/${p.id}`}>{p.jobTitle}</Link>
                  </td>
                  <td>
                    <PaymentStatusPill status={p.status} />
                  </td>
                  <td>
                    {PAYMENT_METHOD_LABELS[p.method]}
                    {p.gateway ? (
                      <div style={{ color: colors.textSecondary, fontSize: 13 }}>{p.gateway}</div>
                    ) : null}
                  </td>
                  <td>{formatMoney(p.amount)}</td>
                  <td>{p.refunded.amountMinor === 0 ? '—' : formatMoney(p.refunded)}</td>
                  <td>
                    {p.customerName}
                    <div style={{ color: colors.textSecondary, fontSize: 13 }}>
                      {p.providerName}
                    </div>
                  </td>
                  <td>{formatDate(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.ok && result.data.nextCursor ? (
        <Link
          href={`/finance/payments?${paymentFiltersToQuery(filters, { cursor: result.data.nextCursor })}`}
          className="btn"
        >
          Sonraki sayfa
        </Link>
      ) : null}
    </div>
  );
}
