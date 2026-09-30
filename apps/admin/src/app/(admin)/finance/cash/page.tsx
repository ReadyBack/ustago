import {
  adminCashSettlementSchema,
  cashSettlementStatusSchema,
  formatMoney,
  paginatedSchema,
} from '@ustago/validation';
import { colors, spacing } from '@ustago/ui';
import Link from 'next/link';

import { CashStatusPill } from '@/components/finance-pills';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { listFilterQuery, parseCashFilter } from '@/lib/finance';
import { CASH_RESOLVE_LABELS, CASH_STATUS_LABELS, formatDate } from '@/lib/labels';

import { ModerationForm } from '../../moderation-form';
import { resolveCash } from '../actions';

export default async function CashPage(props: PageProps<'/finance/cash'>) {
  const filter = parseCashFilter(await props.searchParams);
  const pageQuery = listFilterQuery('status', filter);
  await requireAdmin(`/finance/cash${pageQuery ? `?${pageQuery}` : ''}`);

  const result = await apiRequest(
    `/admin/finance/cash-settlements?${listFilterQuery('status', filter, { api: true })}`,
    { schema: paginatedSchema(adminCashSettlementSchema) },
  );

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <h1>Nakit ödemeler</h1>
      <form method="get" className="card filters" aria-label="Filtreler">
        <label>
          Durum
          <select name="status" defaultValue={filter.value ?? ''}>
            <option value="">Tümü</option>
            {cashSettlementStatusSchema.options.map((s) => (
              <option key={s} value={s}>
                {CASH_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'end' }}>
          <button type="submit" className="btn btn-primary">
            Filtrele
          </button>
          <Link href="/finance/cash?status=DISPUTED" className="btn">
            Anlaşmazlıklar
          </Link>
          <Link href="/finance/cash" className="btn">
            Temizle
          </Link>
        </div>
      </form>
      <p style={{ color: colors.textSecondary }}>
        Ustaya doğrudan ödenen işler. Platform parayı görmez; hizmet bedeli ustanın platforma
        borcuna yazılır. Anlaşmazlıkta iki tarafı dinleyip karar verin.
      </p>

      {!result.ok ? (
        <p role="alert">{result.message}</p>
      ) : result.data.items.length === 0 ? (
        <p className="card">Bu filtreye uyan nakit ödeme yok.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>İş</th>
                <th>Tutar / bedel</th>
                <th>Durum</th>
                <th>Onaylar</th>
                <th>Anlaşmazlık</th>
                <th>Karar</th>
              </tr>
            </thead>
            <tbody>
              {result.data.items.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/jobs/${c.jobId}`}>{c.jobTitle}</Link>
                    <div style={{ color: colors.textSecondary, fontSize: 13 }}>
                      {c.customerName} · {c.providerName}
                    </div>
                  </td>
                  <td>
                    {formatMoney(c.amount)}
                    <div style={{ color: colors.textSecondary, fontSize: 13 }}>
                      Bedel: {formatMoney(c.fee)}
                    </div>
                  </td>
                  <td>
                    <CashStatusPill status={c.status} />
                  </td>
                  <td style={{ fontSize: 13 }}>
                    Müşteri: {formatDate(c.customerConfirmedAt)}
                    <br />
                    Usta: {formatDate(c.providerConfirmedAt)}
                  </td>
                  <td style={{ whiteSpace: 'pre-wrap', maxWidth: 280 }}>
                    {c.disputedAt ? (
                      <>
                        <div style={{ fontSize: 13, color: colors.textSecondary }}>
                          {formatDate(c.disputedAt)}
                        </div>
                        {c.disputeNote ?? '—'}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {c.status === 'DISPUTED' ? (
                      <ModerationForm
                        action={resolveCash}
                        hidden={{ id: c.id }}
                        submitLabel="Karar ver"
                        tone="primary"
                        label="Nakit ödeme anlaşmazlığını sonuçlandır"
                        doneMessage="Karar kaydedildi."
                      >
                        <select name="outcome" required defaultValue="" aria-label="Karar">
                          <option value="" disabled>
                            Seçin
                          </option>
                          {(['CONFIRM_PAID', 'MARK_UNPAID'] as const).map((o) => (
                            <option key={o} value={o}>
                              {CASH_RESOLVE_LABELS[o]}
                            </option>
                          ))}
                        </select>
                        <textarea
                          name="note"
                          required
                          minLength={3}
                          maxLength={1000}
                          rows={2}
                          placeholder="Karar notu"
                          aria-label="Karar notu"
                        />
                      </ModerationForm>
                    ) : (
                      <span style={{ whiteSpace: 'pre-wrap' }}>{c.resolutionNote ?? '—'}</span>
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
          href={`/finance/cash?${listFilterQuery('status', filter, { cursor: result.data.nextCursor })}`}
          className="btn"
        >
          Sonraki sayfa
        </Link>
      ) : null}
    </div>
  );
}
