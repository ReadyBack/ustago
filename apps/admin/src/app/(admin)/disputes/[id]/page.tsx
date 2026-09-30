import { adminDisputeDetailSchema, uuidSchema } from '@ustago/validation';
import { colors, spacing } from '@ustago/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DisputeStatusPill, JobStatusPill } from '@/components/job-pills';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import {
  DISPUTE_FINANCIAL_ACTION_LABELS,
  DISPUTE_OUTCOMES,
  DISPUTE_REASON_LABELS,
  DISPUTE_STATUS_LABELS,
  formatDate,
  JOB_STEP_LABELS,
} from '@/lib/labels';

import { resolveDispute } from '../../moderation-actions';
import { ModerationForm } from '../../moderation-form';

const OPEN = new Set(['OPEN', 'AWAITING_EVIDENCE', 'UNDER_REVIEW']);
const FINANCIAL_ACTIONS = Object.keys(
  DISPUTE_FINANCIAL_ACTION_LABELS,
) as (keyof typeof DISPUTE_FINANCIAL_ACTION_LABELS)[];

export default async function DisputeDetailPage(props: PageProps<'/disputes/[id]'>) {
  const { id: rawId } = await props.params;
  const id = uuidSchema.safeParse(rawId);
  if (!id.success) notFound();
  await requireAdmin(`/disputes/${id.data}`);

  const result = await apiRequest(`/admin/disputes/${id.data}`, {
    schema: adminDisputeDetailSchema,
  });
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <p role="alert">{result.message}</p>;
  }
  const d = result.data;
  const open = OPEN.has(d.status);

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <Link href={`/disputes?group=${open ? 'OPEN' : 'RESOLVED'}`}>← Sorun bildirimleri</Link>
      <header style={{ display: 'flex', gap: spacing.md, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1>{DISPUTE_REASON_LABELS[d.reason]}</h1>
        <DisputeStatusPill status={d.status} />
      </header>

      <section className="grid-2">
        <div className="card">
          <h2>Bildirim</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{d.description}</p>
          <dl style={{ marginTop: spacing.md }}>
            <dt>İş</dt>
            <dd>
              <Link href={`/jobs/${d.job.id}`}>{d.job.title}</Link>{' '}
              <JobStatusPill status={d.job.status} />
            </dd>
            <dt>Müşteri</dt>
            <dd>{d.customer.name}</dd>
            <dt>Usta</dt>
            <dd>
              <Link href={`/providers/${d.provider.id}`}>{d.provider.displayName}</Link>
            </dd>
            <dt>Bildirildi</dt>
            <dd>{formatDate(d.createdAt)}</dd>
          </dl>
          <h3>İş adımları</h3>
          <ol style={{ paddingLeft: 18 }}>
            {d.timeline.map((t) => (
              <li key={t.step} style={t.at ? undefined : { color: colors.textSecondary }}>
                {JOB_STEP_LABELS[t.step]}: {t.at ? formatDate(t.at) : 'henüz değil'}
              </li>
            ))}
          </ol>
        </div>

        <div className="card">
          <h2>Karar</h2>
          {open ? (
            <ModerationForm
              action={resolveDispute}
              hidden={{ id: d.id }}
              submitLabel="Sonuçlandır"
              tone="primary"
              label="Sorun bildirimini sonuçlandır"
              doneMessage="Sonuçlandırıldı; iki tarafa da bildirim gönderildi."
            >
              <label>
                Sonuç
                <select name="outcome" required defaultValue="">
                  <option value="" disabled>
                    Seçin
                  </option>
                  {DISPUTE_OUTCOMES.map((o) => (
                    <option key={o} value={o}>
                      {DISPUTE_STATUS_LABELS[o]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Karar notu (iki tarafa da gösterilir)
                <textarea name="note" required minLength={3} maxLength={2000} rows={4} />
              </label>
              <fieldset
                style={{
                  display: 'grid',
                  gap: spacing.xs,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  padding: spacing.sm,
                }}
              >
                <legend style={{ padding: `0 ${spacing.xs}px` }}>Ödeme</legend>
                <label>
                  Finansal işlem
                  <select name="financialAction" defaultValue="">
                    <option value="">Seçilmedi (ödeme bekletilmiyorsa)</option>
                    {FINANCIAL_ACTIONS.map((a) => (
                      <option key={a} value={a}>
                        {DISPUTE_FINANCIAL_ACTION_LABELS[a]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Kısmi iade tutarı (TL, yalnızca “Müşteriye kısmi iade” için)
                  <input
                    name="refundAmount"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="ör. 250 veya 1.000,50"
                    style={{ minHeight: 40, padding: 8 }}
                  />
                </label>
                <p style={{ color: colors.textSecondary, fontSize: 13 }}>
                  İş uygulamadan ödendiyse para karar verilene kadar bekletilir: müşteriye iade edin
                  ya da ustaya aktarın. İade geri alınamaz.
                </p>
              </fieldset>
              <p style={{ color: colors.textSecondary, fontSize: 13 }}>
                İş “Sorun bildirildi” durumunda kalır. Ustaya yaptırım gerekiyorsa ustanın kalite
                kartından ayrıca verilir.
              </p>
            </ModerationForm>
          ) : (
            <dl>
              <dt>Sonuç</dt>
              <dd>{DISPUTE_STATUS_LABELS[d.status]}</dd>
              <dt>Not</dt>
              <dd style={{ whiteSpace: 'pre-wrap' }}>{d.resolution ?? '—'}</dd>
              <dt>Karar veren</dt>
              <dd>{d.resolvedBy?.name ?? '—'}</dd>
              <dt>Tarih</dt>
              <dd>{formatDate(d.resolvedAt)}</dd>
            </dl>
          )}
        </div>
      </section>
    </div>
  );
}
