import { auditEventSchema, paginatedSchema } from '@ustago/validation';
import { spacing } from '@ustago/ui';
import Link from 'next/link';

import { AuditTable } from '@/components/audit-table';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import {
  auditFiltersToApiQuery,
  auditFiltersToQuery,
  parseAuditFilters,
} from '@/lib/trust-filters';

export default async function AuditPage(props: PageProps<'/audit'>) {
  const filters = parseAuditFilters(await props.searchParams);
  const pageQuery = auditFiltersToQuery(filters, filters.cursor ? { cursor: filters.cursor } : {});
  await requireAdmin(`/audit${pageQuery ? `?${pageQuery}` : ''}`);

  const result = await apiRequest(`/admin/audit-events?${auditFiltersToApiQuery(filters)}`, {
    schema: paginatedSchema(auditEventSchema),
  });

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <h1>Denetim kayıtları</h1>
      <p className="muted">
        Yönetici ve sistem işlemlerinin değiştirilemez kaydı, en yeni en üstte. İşlem alanına tam ad
        (ör. <code>provider.approved</code>) ya da noktayla biten bir ön ek (ör.{' '}
        <code>fee_policy.</code>) yazabilirsiniz. Tarihler İstanbul saatine göredir.
      </p>
      <form method="get" className="card filters" aria-label="Filtreler">
        <label>
          Kayıt türü
          <input
            name="entityType"
            defaultValue={filters.entityType ?? ''}
            placeholder="ör. provider_profile"
            style={{ minHeight: 40, padding: 8 }}
          />
        </label>
        <label>
          Kayıt kimliği
          <input
            name="entityId"
            defaultValue={filters.entityId ?? ''}
            style={{ minHeight: 40, padding: 8 }}
          />
        </label>
        <label>
          Yapan (kullanıcı kimliği)
          <input
            name="actorId"
            defaultValue={filters.actorId ?? ''}
            style={{ minHeight: 40, padding: 8 }}
          />
        </label>
        <label>
          İşlem
          <input
            name="action"
            defaultValue={filters.action ?? ''}
            placeholder="ör. provider."
            style={{ minHeight: 40, padding: 8 }}
          />
        </label>
        <label>
          Başlangıç
          <input
            type="date"
            name="from"
            defaultValue={filters.from ?? ''}
            style={{ minHeight: 40, padding: 8 }}
          />
        </label>
        <label>
          Bitiş
          <input
            type="date"
            name="to"
            defaultValue={filters.to ?? ''}
            style={{ minHeight: 40, padding: 8 }}
          />
        </label>
        <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'end' }}>
          <button type="submit" className="btn btn-primary">
            Filtrele
          </button>
          <Link href="/audit" className="btn">
            Temizle
          </Link>
        </div>
      </form>

      {!result.ok ? (
        <p role="alert">{result.message}</p>
      ) : result.data.items.length === 0 ? (
        <p className="card">Bu filtreye uyan kayıt yok.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <AuditTable events={result.data.items} />
        </div>
      )}
      <div style={{ display: 'flex', gap: spacing.sm }}>
        {filters.cursor ? (
          <Link href={`/audit?${auditFiltersToQuery(filters)}`} className="btn">
            İlk sayfa
          </Link>
        ) : null}
        {result.ok && result.data.nextCursor ? (
          <Link
            href={`/audit?${auditFiltersToQuery(filters, { cursor: result.data.nextCursor })}`}
            className="btn"
          >
            Sonraki sayfa
          </Link>
        ) : null}
      </div>
    </div>
  );
}
