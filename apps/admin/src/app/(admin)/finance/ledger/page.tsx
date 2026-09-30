import {
  formatMoney,
  ledgerTransactionTypeSchema,
  ledgerTransactionViewSchema,
  paginatedSchema,
} from '@ustago/validation';
import { colors, spacing } from '@ustago/ui';
import Link from 'next/link';

import { ImbalanceBadge } from '@/components/ledger-transaction';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { ledgerFiltersToQuery, parseLedgerFilters } from '@/lib/finance';
import { formatDate, LEDGER_TRANSACTION_LABELS } from '@/lib/labels';

export default async function LedgerPage(props: PageProps<'/finance/ledger'>) {
  const filters = parseLedgerFilters(await props.searchParams);
  const pageQuery = ledgerFiltersToQuery(filters, filters.cursor ? { cursor: filters.cursor } : {});
  await requireAdmin(`/finance/ledger${pageQuery ? `?${pageQuery}` : ''}`);

  const result = await apiRequest(
    `/admin/finance/ledger?${ledgerFiltersToQuery(filters, {}, { api: true })}`,
    { schema: paginatedSchema(ledgerTransactionViewSchema) },
  );

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <h1>Defter</h1>
      <form method="get" className="card filters" aria-label="Filtreler">
        {filters.paymentId ? (
          <input type="hidden" name="paymentId" value={filters.paymentId} />
        ) : null}
        {filters.providerId ? (
          <input type="hidden" name="providerId" value={filters.providerId} />
        ) : null}
        <label>
          Kayıt türü
          <select name="type" defaultValue={filters.type ?? ''}>
            <option value="">Tümü</option>
            {ledgerTransactionTypeSchema.options.map((t) => (
              <option key={t} value={t}>
                {LEDGER_TRANSACTION_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'end' }}>
          <button type="submit" className="btn btn-primary">
            Filtrele
          </button>
          <Link href="/finance/ledger" className="btn">
            Temizle
          </Link>
        </div>
      </form>
      {filters.paymentId || filters.providerId ? (
        <p style={{ color: colors.textSecondary }}>
          {filters.paymentId ? (
            <>
              <Link href={`/finance/payments/${filters.paymentId}`}>Tek bir ödemenin</Link>{' '}
              kayıtları gösteriliyor.{' '}
            </>
          ) : null}
          {filters.providerId ? 'Tek bir ustanın kayıtları gösteriliyor. ' : ''}
          <Link href="/finance/ledger">Tüm kayıtlar</Link>
        </p>
      ) : null}
      <p style={{ color: colors.textSecondary }}>
        Salt okunur çift taraflı kayıtlar. Her kayıtta borç ve alacak toplamı eşit olmalıdır; eşit
        olmayan kayıt kırmızıyla işaretlenir.
      </p>

      {!result.ok ? (
        <p role="alert">{result.message}</p>
      ) : result.data.items.length === 0 ? (
        <p className="card">Bu filtreye uyan kayıt yok.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Kayıt</th>
                <th>Borç</th>
                <th>Alacak</th>
                <th>Denge</th>
                <th>Satır</th>
                <th>Tarih</th>
              </tr>
            </thead>
            <tbody>
              {result.data.items.map((tx) => (
                <tr
                  key={tx.id}
                  style={tx.imbalance.amountMinor !== 0 ? { background: '#FDE8E6' } : undefined}
                >
                  <td>
                    <Link href={`/finance/ledger/${tx.id}`}>
                      {LEDGER_TRANSACTION_LABELS[tx.type]}
                    </Link>
                    {tx.description ? (
                      <div style={{ color: colors.textSecondary, fontSize: 13 }}>
                        {tx.description}
                      </div>
                    ) : null}
                  </td>
                  <td>{formatMoney(tx.totalDebit)}</td>
                  <td>{formatMoney(tx.totalCredit)}</td>
                  <td>
                    <ImbalanceBadge imbalanceMinor={tx.imbalance.amountMinor} />
                  </td>
                  <td>{tx.entries.length}</td>
                  <td>{formatDate(tx.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.ok && result.data.nextCursor ? (
        <Link
          href={`/finance/ledger?${ledgerFiltersToQuery(filters, { cursor: result.data.nextCursor })}`}
          className="btn"
        >
          Sonraki sayfa
        </Link>
      ) : null}
    </div>
  );
}
