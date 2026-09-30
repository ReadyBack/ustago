import {
  adminMessageReportSchema,
  messageReportStatusSchema,
  paginatedSchema,
} from '@ustago/validation';
import { spacing } from '@ustago/ui';
import Link from 'next/link';

import { ApiErrorNotice } from '@/components/api-error';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import {
  CONVERSATION_ROLE_LABELS,
  formatDate,
  MESSAGE_REPORT_REASON_LABELS,
  MESSAGE_REPORT_STATUS_LABELS,
} from '@/lib/labels';
import { parseCursor } from '@/lib/marketplace';

import { resolveMessageReport } from '../marketplace-actions';
import { ModerationForm } from '../moderation-form';
import { ReportReview } from './report-review';

const STATUS_TONE = { OPEN: 'warning', REVIEWED: 'success', DISMISSED: 'neutral' } as const;

export default async function MessageReportsPage(props: PageProps<'/message-reports'>) {
  const params = await props.searchParams;
  const rawStatus = Array.isArray(params.status) ? params.status[0] : params.status;
  // Default: open reports. `status=ALL` lists every report.
  const status =
    rawStatus === 'ALL'
      ? undefined
      : (messageReportStatusSchema.safeParse(rawStatus ?? 'OPEN').data ?? 'OPEN');
  const cursor = parseCursor(params.cursor);
  const query = new URLSearchParams({ status: status ?? 'ALL' });
  if (cursor) query.set('cursor', cursor);
  await requireAdmin(`/message-reports?${query.toString()}`);

  const apiQuery = new URLSearchParams({ limit: '25' });
  if (status) apiQuery.set('status', status);
  if (cursor) apiQuery.set('cursor', cursor);
  const result = await apiRequest(`/admin/message-reports?${apiQuery.toString()}`, {
    schema: paginatedSchema(adminMessageReportSchema),
  });

  const tabs = [...messageReportStatusSchema.options, 'ALL'] as const;

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <h1>Mesaj şikayetleri</h1>
      <p className="muted">
        Listede mesaj içerikleri gösterilmez. Konuşmayı okumak için yazılı bir gerekçe gerekir; her
        erişim denetim kaydına yazılır.
      </p>
      <nav className="tabs" aria-label="Durum">
        {tabs.map((t) => {
          const active = (status ?? 'ALL') === t;
          return (
            <Link
              key={t}
              href={`/message-reports?status=${t}`}
              className={`tab${active ? ' tab-active' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              {t === 'ALL' ? 'Tümü' : MESSAGE_REPORT_STATUS_LABELS[t]}
            </Link>
          );
        })}
      </nav>

      {!result.ok ? (
        <ApiErrorNotice error={result} what="Mesaj şikayetleri" />
      ) : result.data.items.length === 0 ? (
        <p className="card">Bu durumda şikayet yok.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: spacing.md }}>
          {result.data.items.map((r) => (
            <li key={r.id} className="card" style={{ display: 'grid', gap: spacing.sm }}>
              <div
                style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap', alignItems: 'center' }}
              >
                <strong>{MESSAGE_REPORT_REASON_LABELS[r.reason]}</strong>
                <span className={`pill pill-${STATUS_TONE[r.status]}`}>
                  {MESSAGE_REPORT_STATUS_LABELS[r.status]}
                </span>
              </div>
              <dl>
                <dt>Şikayet eden</dt>
                <dd>{CONVERSATION_ROLE_LABELS[r.reporterRole]}</dd>
                <dt>Tarih</dt>
                <dd>{formatDate(r.createdAt)}</dd>
                <dt>Şikayet notu</dt>
                <dd style={{ whiteSpace: 'pre-wrap' }}>{r.note ?? '—'}</dd>
                {r.reviewedAt ? (
                  <>
                    <dt>Sonuçlandı</dt>
                    <dd>{formatDate(r.reviewedAt)}</dd>
                  </>
                ) : null}
              </dl>
              <ReportReview reportId={r.id} />
              {r.status === 'OPEN' ? (
                <details>
                  <summary>Sonuçlandır</summary>
                  <div style={{ marginTop: spacing.sm, maxWidth: 560 }}>
                    <ModerationForm
                      action={resolveMessageReport}
                      hidden={{ reportId: r.id }}
                      submitLabel="Sonuçlandır"
                      tone="primary"
                      label="Şikayeti sonuçlandır"
                      doneMessage="Sonuçlandırıldı."
                    >
                      <label className="field">
                        Karar
                        <select name="status" required defaultValue="">
                          <option value="" disabled>
                            Seçin
                          </option>
                          <option value="REVIEWED">İncelendi (gerekli işlem yapıldı)</option>
                          <option value="DISMISSED">Yok say (ihlal yok)</option>
                        </select>
                      </label>
                      <label className="field">
                        Not (3–500 karakter)
                        <textarea name="note" rows={3} required minLength={3} maxLength={500} />
                      </label>
                    </ModerationForm>
                  </div>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {result.ok && result.data.nextCursor ? (
        <Link
          href={`/message-reports?${new URLSearchParams({
            status: status ?? 'ALL',
            cursor: result.data.nextCursor,
          }).toString()}`}
          className="btn"
        >
          Sonraki sayfa
        </Link>
      ) : null}
    </div>
  );
}
