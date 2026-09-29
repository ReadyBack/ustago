import { adminProviderDetailSchema, uuidSchema } from '@ustago/validation';
import { colors, spacing } from '@ustago/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ProviderStatusPill, VerificationStatusPill } from '@/components/status-pill';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { formatDate, ONBOARDING_STEP_LABELS, VERIFICATION_TYPE_LABELS } from '@/lib/labels';

import { ReviewForm } from '../review-form';

export default async function ProviderDetailPage(props: PageProps<'/providers/[id]'>) {
  const { id: rawId } = await props.params;
  const id = uuidSchema.safeParse(rawId);
  if (!id.success) notFound();
  await requireAdmin(`/providers/${id.data}`);

  const result = await apiRequest(`/admin/providers/${id.data}`, {
    schema: adminProviderDetailSchema,
  });
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <p role="alert">{result.message}</p>;
  }
  const p = result.data;
  const pendingReview = p.status === 'PENDING_REVIEW';

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <Link href="/providers">← Başvurular</Link>
      <header style={{ display: 'flex', gap: spacing.md, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1>{p.displayName}</h1>
        <ProviderStatusPill status={p.status} />
      </header>
      {p.statusReason ? (
        <p className="card" style={{ borderColor: colors.warning }}>
          <strong>Son karar sebebi:</strong> {p.statusReason}
        </p>
      ) : null}

      <section className="grid-2">
        <div className="card">
          <h2>Başvuran</h2>
          <dl>
            <dt>Ad soyad</dt>
            <dd>
              {p.contact.firstName} {p.contact.lastName}
            </dd>
            <dt>Telefon</dt>
            <dd>
              {p.contact.phone ?? '—'}{' '}
              {p.contact.phoneVerifiedAt ? '(doğrulandı)' : '(doğrulanmadı)'}
            </dd>
            <dt>E-posta</dt>
            <dd>{p.contact.email ?? '—'}</dd>
            <dt>Başvuru</dt>
            <dd>{formatDate(p.submittedAt)}</dd>
            <dt>Deneyim</dt>
            <dd>{p.yearsOfExperience === null ? '—' : `${p.yearsOfExperience} yıl`}</dd>
          </dl>
          <p style={{ marginTop: spacing.md, whiteSpace: 'pre-wrap' }}>{p.bio ?? 'Tanıtım yok.'}</p>
        </div>
        <div className="card">
          <h2>Onboarding</h2>
          <ul className="checklist">
            {(Object.keys(ONBOARDING_STEP_LABELS) as (keyof typeof ONBOARDING_STEP_LABELS)[]).map(
              (step) => {
                const done = !p.onboarding.missingSteps.includes(step);
                return (
                  <li key={step} data-done={done}>
                    {done ? '✓' : '○'} {ONBOARDING_STEP_LABELS[step]}
                  </li>
                );
              },
            )}
          </ul>
          <h3>Hizmetler</h3>
          <p>{p.services.map((s) => s.name).join(', ') || '—'}</p>
          <h3>Bölgeler</h3>
          <ul>
            {p.serviceAreas.map((g) => (
              <li key={g.province.id}>
                {g.province.name}: {g.districts.map((d) => d.name).join(', ')}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="card">
        <h2>Belgeler</h2>
        {p.verifications.length === 0 ? <p>Belge yüklenmemiş.</p> : null}
        <div style={{ display: 'grid', gap: spacing.md }}>
          {p.verifications.map((v) => (
            <article key={v.id} className="verification">
              <div style={{ display: 'grid', gap: spacing.xs }}>
                <strong>{VERIFICATION_TYPE_LABELS[v.type]}</strong>
                <span>
                  <VerificationStatusPill status={v.status} /> · {formatDate(v.submittedAt)}
                </span>
                <span style={{ color: colors.textSecondary }}>
                  {v.mimeType ?? '—'} · {v.sizeBytes ? `${Math.ceil(v.sizeBytes / 1024)} KB` : '—'}
                </span>
                {v.rejectionReason ? <span>Red sebebi: {v.rejectionReason}</span> : null}
                {v.hasDocument ? (
                  <a
                    href={`/verifications/${v.id}/document`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Belgeyi görüntüle
                  </a>
                ) : null}
              </div>
              {v.status === 'PENDING' ? (
                <div className="actions">
                  <ReviewForm
                    target="verification"
                    id={v.id}
                    providerId={p.id}
                    decision="approve"
                    label="Belgeyi onayla"
                    tone="primary"
                  />
                  <ReviewForm
                    target="verification"
                    id={v.id}
                    providerId={p.id}
                    decision="reject"
                    label="Belgeyi reddet"
                    tone="danger"
                    withReason
                  />
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Karar</h2>
        <div className="actions">
          {pendingReview ? (
            <>
              <ReviewForm
                target="provider"
                id={p.id}
                providerId={p.id}
                decision="approve"
                label="Ustayı onayla"
                tone="primary"
              />
              <ReviewForm
                target="provider"
                id={p.id}
                providerId={p.id}
                decision="reject"
                label="Başvuruyu reddet"
                tone="danger"
                withReason
              />
            </>
          ) : null}
          {p.status === 'ACTIVE' ? (
            <ReviewForm
              target="provider"
              id={p.id}
              providerId={p.id}
              decision="suspend"
              label="Askıya al"
              tone="danger"
              withReason
            />
          ) : null}
          {p.status === 'SUSPENDED' ? (
            <ReviewForm
              target="provider"
              id={p.id}
              providerId={p.id}
              decision="reinstate"
              label="Yeniden aktif et"
              tone="primary"
            />
          ) : null}
          {!pendingReview && p.status !== 'ACTIVE' && p.status !== 'SUSPENDED' ? (
            <p>Bu durumda yapılacak bir karar yok.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
