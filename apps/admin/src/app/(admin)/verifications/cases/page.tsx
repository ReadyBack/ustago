import { paginatedSchema } from '@ustago/validation';
import { spacing } from '@ustago/ui';
import Link from 'next/link';

import { ProviderStatusPill } from '@/components/status-pill';
import { AccountStatusPill, VerificationCasePill } from '@/components/trust-pills';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import {
  formatDate,
  PROVIDER_VERIFICATION_STATUS_LABELS,
  VERIFICATION_CASE_FILTERS,
} from '@/lib/labels';
import { adminVerificationCaseListItemSchema } from '@/lib/schemas';
import { parseVerificationCaseQuery, verificationCaseQueryString } from '@/lib/trust-filters';

export default async function VerificationCasesPage(props: PageProps<'/verifications/cases'>) {
  const query = parseVerificationCaseQuery(await props.searchParams);
  await requireAdmin(`/verifications/cases?${verificationCaseQueryString(query)}`);

  const result = await apiRequest(
    `/admin/verification-cases?${verificationCaseQueryString(query, { api: true })}`,
    { schema: paginatedSchema(adminVerificationCaseListItemSchema) },
  );
  const fifo = query.status === 'SUBMITTED' || query.status === 'UNDER_REVIEW';

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <h1>Doğrulama talepleri</h1>
      <p className="muted">
        Ustaların hesap doğrulama başvuruları. Karar vermeden önce başvuruyu “İncelemeye al” ile
        üstlenin; aynı başvuruya iki yönetici aynı anda karar veremez.{' '}
        <Link href="/verifications">Tek tek belge kuyruğu</Link>
      </p>
      <nav aria-label="Durum" style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap' }}>
        {VERIFICATION_CASE_FILTERS.map((s) => (
          <Link
            key={s}
            href={`/verifications/cases?status=${s}`}
            className={`chip${s === query.status ? ' chip-active' : ''}`}
            aria-current={s === query.status ? 'page' : undefined}
          >
            {PROVIDER_VERIFICATION_STATUS_LABELS[s]}
          </Link>
        ))}
      </nav>
      {fifo ? <p className="muted">En eski başvuru en üstte.</p> : null}

      {!result.ok ? (
        <p role="alert">{result.message}</p>
      ) : result.data.items.length === 0 ? (
        <p className="card">Bu durumda başvuru yok.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Usta</th>
                <th>Doğrulama</th>
                <th>Hesap</th>
                <th>Belge</th>
                <th>Gönderildi</th>
                <th>İnceleyen</th>
              </tr>
            </thead>
            <tbody>
              {result.data.items.map((c) => (
                <tr key={c.providerId}>
                  <td>
                    <Link href={`/verifications/cases/${c.providerId}`}>{c.displayName}</Link>
                    <div className="muted">{c.contactName}</div>
                  </td>
                  <td>
                    <VerificationCasePill status={c.status} />
                    {c.submissionCount > 1 ? (
                      <div className="muted">{c.submissionCount}. gönderim</div>
                    ) : null}
                  </td>
                  <td style={{ display: 'grid', gap: spacing.xs, justifyItems: 'start' }}>
                    <ProviderStatusPill status={c.providerStatus} />
                    <AccountStatusPill status={c.accountStatus} />
                  </td>
                  <td>{c.documentCount}</td>
                  <td>{formatDate(c.submittedAt)}</td>
                  <td>{c.reviewedBy?.name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.ok && result.data.nextCursor ? (
        <Link
          href={`/verifications/cases?${verificationCaseQueryString(query, { cursor: result.data.nextCursor })}`}
          className="btn"
        >
          Sonraki sayfa
        </Link>
      ) : null}
    </div>
  );
}
