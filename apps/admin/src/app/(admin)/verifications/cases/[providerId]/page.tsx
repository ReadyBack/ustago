import type { AdminVerificationCaseDetail } from '@ustago/types';
import { uuidSchema, VERIFICATION_REASON_CODES } from '@ustago/validation';
import { colors, spacing } from '@ustago/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ProviderStatusPill, VerificationStatusPill } from '@/components/status-pill';
import { AccountStatusPill, VerificationCasePill } from '@/components/trust-pills';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import {
  DOCUMENT_SCAN_STATUS_LABELS,
  formatDate,
  labelOf,
  PROVIDER_VERIFICATION_STATUS_LABELS,
  TIMELINE_ACTOR_LABELS,
  VERIFICATION_REASON_LABELS,
  VERIFICATION_TYPE_LABELS,
} from '@/lib/labels';
import { adminVerificationCaseDetailSchema } from '@/lib/schemas';

import { ModerationForm } from '../../../moderation-form';
import { decideVerificationCase } from '../../../trust-actions';

export default async function VerificationCaseDetailPage(
  props: PageProps<'/verifications/cases/[providerId]'>,
) {
  const { providerId: rawId } = await props.params;
  const id = uuidSchema.safeParse(rawId);
  if (!id.success) notFound();
  await requireAdmin(`/verifications/cases/${id.data}`);

  const result = await apiRequest(`/admin/verification-cases/${id.data}`, {
    schema: adminVerificationCaseDetailSchema,
  });
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <p role="alert">{result.message}</p>;
  }
  const c = result.data;
  const missing = c.requiredDocumentTypes.filter(
    (t) => !c.documents.some((d) => d.type === t && d.status !== 'REJECTED'),
  );

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <Link href={`/verifications/cases?status=${listStatus(c.status)}`}>
        ← Doğrulama talepleri
      </Link>
      <header style={{ display: 'flex', gap: spacing.md, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1>{c.displayName}</h1>
        <VerificationCasePill status={c.status} />
        <ProviderStatusPill status={c.providerStatus} />
        <AccountStatusPill status={c.accountStatus} />
      </header>
      <p>
        <Link href={`/providers/${c.providerId}/360`}>Usta 360</Link> ·{' '}
        <Link href={`/providers/${c.providerId}`}>Başvuru sayfası</Link> ·{' '}
        <Link href={`/audit?entityId=${c.providerId}`}>Denetim kayıtları</Link>
      </p>

      <section className="grid-2">
        <div className="card">
          <h2>Başvuru</h2>
          <dl>
            <dt>Ad soyad</dt>
            <dd>
              {c.contact.firstName} {c.contact.lastName}
            </dd>
            <dt>Telefon</dt>
            <dd>{c.contact.phoneMasked ?? '—'}</dd>
            <dt>Gönderildi</dt>
            <dd>
              {formatDate(c.submittedAt)}
              {c.submissionCount > 1 ? ` (${c.submissionCount}. gönderim)` : ''}
            </dd>
            <dt>İnceleyen</dt>
            <dd>
              {c.reviewedBy?.name ?? '—'}
              {c.reviewStartedAt ? ` · ${formatDate(c.reviewStartedAt)}` : ''}
            </dd>
            <dt>Son karar</dt>
            <dd>
              {c.decisionBy?.name ?? '—'}
              {c.decidedAt ? ` · ${formatDate(c.decidedAt)}` : ''}
            </dd>
            {c.decisionReasonCode ? (
              <>
                <dt>Gerekçe kodu</dt>
                <dd>{labelOf(VERIFICATION_REASON_LABELS, c.decisionReasonCode)}</dd>
              </>
            ) : null}
            {c.userVisibleReason ? (
              <>
                <dt>Ustaya açıklama</dt>
                <dd style={{ whiteSpace: 'pre-wrap' }}>{c.userVisibleReason}</dd>
              </>
            ) : null}
            {c.internalNote ? (
              <>
                <dt>İç not</dt>
                <dd style={{ whiteSpace: 'pre-wrap' }}>{c.internalNote}</dd>
              </>
            ) : null}
            <dt>Doğrulandı</dt>
            <dd>{formatDate(c.verifiedAt)}</dd>
            <dt>Sürüm</dt>
            <dd>
              v{c.version} · {c.source}
            </dd>
          </dl>
        </div>
        <div className="card">
          <h2>Kontrol listesi</h2>
          <ul className="checklist">
            {c.checklist.map((item) => (
              <li key={item.key} data-done={item.done}>
                {item.done ? '✓' : '○'} {item.label}
              </li>
            ))}
          </ul>
          <h3>Hizmetler</h3>
          <p>{c.categories.join(', ') || '—'}</p>
          <h3>Bölgeler</h3>
          <p>{c.areas.join(', ') || '—'}</p>
          <h3>Zorunlu belgeler</h3>
          <p>{c.requiredDocumentTypes.map((t) => VERIFICATION_TYPE_LABELS[t]).join(', ') || '—'}</p>
          {missing.length > 0 ? (
            <p role="alert" style={{ color: colors.emergency, fontSize: 14 }}>
              Eksik: {missing.map((t) => VERIFICATION_TYPE_LABELS[t]).join(', ')}
            </p>
          ) : null}
        </div>
      </section>

      <section className="card">
        <h2>Belgeler</h2>
        {c.documents.length === 0 ? <p>Belge yüklenmemiş.</p> : null}
        {c.documents.map((d) => (
          <article key={d.id} className="verification">
            <div style={{ display: 'grid', gap: spacing.xs }}>
              <strong>
                {VERIFICATION_TYPE_LABELS[d.type]}
                {c.requiredDocumentTypes.includes(d.type) ? ' (zorunlu)' : ''}
              </strong>
              <span>
                <VerificationStatusPill status={d.status} /> · {formatDate(d.submittedAt)}
              </span>
              <span className="muted">
                {d.mimeType ?? '—'} · {d.sizeBytes ? `${Math.ceil(d.sizeBytes / 1024)} KB` : '—'} ·
                Tarama: {DOCUMENT_SCAN_STATUS_LABELS[d.scanStatus]}
              </span>
              {d.duplicateOfOtherProvider ? (
                <span className="pill pill-danger">Aynı dosya başka bir ustada da var</span>
              ) : null}
              {d.rejectionReason ? <span>Red sebebi: {d.rejectionReason}</span> : null}
            </div>
            <a href={`/verifications/${d.id}/document`} target="_blank" rel="noopener noreferrer">
              Belgeyi görüntüle
            </a>
          </article>
        ))}
      </section>

      <DecisionSection c={c} />

      <section className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <h2 style={{ padding: `${spacing.md}px ${spacing.md}px 0` }}>Olay geçmişi</h2>
        {c.timeline.length === 0 ? (
          <p style={{ padding: spacing.md }}>Henüz olay yok.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Zaman</th>
                <th>Geçiş</th>
                <th>Yapan</th>
                <th>Açıklama</th>
              </tr>
            </thead>
            <tbody>
              {c.timeline.map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.createdAt)}</td>
                  <td>
                    {e.fromStatus ? PROVIDER_VERIFICATION_STATUS_LABELS[e.fromStatus] : '—'} →{' '}
                    <strong>{PROVIDER_VERIFICATION_STATUS_LABELS[e.toStatus]}</strong>
                    <div className="muted">
                      <code>{e.event}</code>
                    </div>
                  </td>
                  <td>
                    {TIMELINE_ACTOR_LABELS[e.actorType]}
                    {e.actor ? <div className="muted">{e.actor.name}</div> : null}
                  </td>
                  <td>
                    {e.reasonCode ? (
                      <div>{labelOf(VERIFICATION_REASON_LABELS, e.reasonCode)}</div>
                    ) : null}
                    {e.userVisibleReason ? <div>{e.userVisibleReason}</div> : null}
                    {e.internalNote ? <div className="muted">İç not: {e.internalNote}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/** The list tab this case belongs to (NOT_STARTED / IN_PROGRESS are never listed). */
function listStatus(status: AdminVerificationCaseDetail['status']): string {
  return status === 'NOT_STARTED' || status === 'IN_PROGRESS' ? 'SUBMITTED' : status;
}

function ReasonFields() {
  return (
    <>
      <label className="field">
        Gerekçe kodu
        <select name="reasonCode" required defaultValue="">
          <option value="" disabled>
            Seçin
          </option>
          {VERIFICATION_REASON_CODES.map((code) => (
            <option key={code} value={code}>
              {VERIFICATION_REASON_LABELS[code]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Ustaya gösterilecek açıklama
        <textarea name="userVisibleReason" required minLength={5} maxLength={500} rows={3} />
      </label>
      <InternalNote />
    </>
  );
}

function InternalNote() {
  return (
    <label className="field">
      İç not (yalnızca yöneticiler görür, isteğe bağlı)
      <textarea name="internalNote" maxLength={2000} rows={2} />
    </label>
  );
}

function DecisionSection({ c }: { c: AdminVerificationCaseDetail }) {
  const hidden = { providerId: c.providerId, expectedVersion: String(c.version) };
  const { actions } = c;
  const any = actions.startReview || actions.approve || actions.requestRevision || actions.reject;
  return (
    <section className="card" style={{ display: 'grid', gap: spacing.md }}>
      <h2>Karar</h2>
      {!any ? (
        <p>Bu durumda yapılacak bir karar yok.</p>
      ) : (
        <p className="muted">
          Kararlar başvurunun v{c.version} sürümüne göre verilir. Siz incelerken başka biri işlem
          yaparsa karar kaydedilmez; sayfayı yenileyin.
        </p>
      )}
      {actions.startReview ? (
        <div style={{ maxWidth: 360 }}>
          <ModerationForm
            action={decideVerificationCase}
            hidden={{ ...hidden, decision: 'start-review' }}
            submitLabel="İncelemeye al"
            tone="primary"
            label="İncelemeye al"
            doneMessage="Başvuru incelemenize alındı."
          />
        </div>
      ) : null}
      <div className="grid-2">
        {actions.approve ? (
          <div>
            <h3>Onayla</h3>
            <ModerationForm
              action={decideVerificationCase}
              hidden={{ ...hidden, decision: 'approve' }}
              submitLabel="Onayla"
              tone="primary"
              label="Doğrulamayı onayla"
              doneMessage="Onaylandı; ustaya bildirim gönderildi."
            >
              <InternalNote />
            </ModerationForm>
          </div>
        ) : null}
        {actions.requestRevision ? (
          <div>
            <h3>Revizyon iste</h3>
            <ModerationForm
              action={decideVerificationCase}
              hidden={{ ...hidden, decision: 'request-revision' }}
              submitLabel="Revizyon iste"
              label="Revizyon iste"
              doneMessage="Revizyon istendi; usta belgeleri güncelleyip yeniden gönderebilir."
            >
              <ReasonFields />
              {c.documents.length > 0 ? (
                <fieldset
                  style={{
                    display: 'grid',
                    gap: spacing.xs,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 6,
                    padding: spacing.sm,
                  }}
                >
                  <legend className="muted" style={{ padding: `0 ${spacing.xs}px` }}>
                    Reddedilecek belgeler (isteğe bağlı)
                  </legend>
                  {c.documents
                    .filter((d) => d.status === 'PENDING' || d.status === 'APPROVED')
                    .map((d) => (
                      <label key={d.id} className="check">
                        <input type="checkbox" name="rejectDocumentIds" value={d.id} />
                        {VERIFICATION_TYPE_LABELS[d.type]} · {formatDate(d.submittedAt)}
                      </label>
                    ))}
                </fieldset>
              ) : null}
            </ModerationForm>
          </div>
        ) : null}
        {actions.reject ? (
          <div>
            <h3>Reddet</h3>
            <ModerationForm
              action={decideVerificationCase}
              hidden={{ ...hidden, decision: 'reject' }}
              submitLabel="Reddet"
              tone="danger"
              label="Doğrulamayı reddet"
              doneMessage="Reddedildi; ustaya bildirim gönderildi."
            >
              <ReasonFields />
            </ModerationForm>
          </div>
        ) : null}
      </div>
    </section>
  );
}
