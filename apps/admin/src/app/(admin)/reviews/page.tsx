import {
  adminReviewSchema,
  paginatedSchema,
  reviewStatusSchema,
  uuidSchema,
} from '@ustago/validation';
import { colors, spacing } from '@ustago/ui';
import Link from 'next/link';

import { RatingText, ReviewStatusPill } from '@/components/job-pills';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { formatDate, REVIEW_STATUS_LABELS } from '@/lib/labels';

import { moderateReview } from '../moderation-actions';
import { ModerationForm } from '../moderation-form';

const SUB_RATINGS = [
  ['qualityRating', 'İşçilik'],
  ['communicationRating', 'İletişim'],
  ['punctualityRating', 'Dakiklik'],
  ['valueRating', 'Fiyat/performans'],
] as const;

export default async function ReviewsPage(props: PageProps<'/reviews'>) {
  const params = await props.searchParams;
  const status = reviewStatusSchema.safeParse(params['status']);
  const providerId = uuidSchema.safeParse(params['providerId']);
  const cursor = uuidSchema.safeParse(params['cursor']);
  const filter = new URLSearchParams();
  if (status.success) filter.set('status', status.data);
  if (providerId.success) filter.set('providerId', providerId.data);
  const pageQuery = new URLSearchParams(filter);
  if (cursor.success) pageQuery.set('cursor', cursor.data);
  await requireAdmin(`/reviews${pageQuery.size ? `?${pageQuery.toString()}` : ''}`);

  const result = await apiRequest(`/admin/reviews?${pageQuery.toString()}&limit=25`, {
    schema: paginatedSchema(adminReviewSchema),
  });
  const nextCursor = result.ok ? result.data.nextCursor : null;
  const nextQuery = new URLSearchParams(filter);
  if (nextCursor) nextQuery.set('cursor', nextCursor);

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <h1>Değerlendirmeler</h1>
      <form method="get" className="card filters" aria-label="Filtreler">
        {providerId.success ? (
          <input type="hidden" name="providerId" value={providerId.data} />
        ) : null}
        <label>
          Durum
          <select name="status" defaultValue={status.success ? status.data : ''}>
            <option value="">Tümü</option>
            {reviewStatusSchema.options.map((s) => (
              <option key={s} value={s}>
                {REVIEW_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'end' }}>
          <button type="submit" className="btn btn-primary">
            Filtrele
          </button>
          <Link href="/reviews" className="btn">
            Temizle
          </Link>
        </div>
      </form>
      <p style={{ color: colors.textSecondary }}>
        Gizlenen değerlendirmeler ustanın profilinden ve puan ortalamasından çıkar; kayıt silinmez,
        her karar denetim kaydına yazılır.
      </p>

      {!result.ok ? (
        <p role="alert">{result.message}</p>
      ) : result.data.items.length === 0 ? (
        <p className="card">Bu filtreye uyan değerlendirme yok.</p>
      ) : (
        <div style={{ display: 'grid', gap: spacing.md }}>
          {result.data.items.map((r) => (
            <article key={r.id} className="card" style={{ display: 'grid', gap: spacing.sm }}>
              <div
                style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' }}
              >
                <RatingText value={r.rating} />
                <ReviewStatusPill status={r.status} />
                <span style={{ color: colors.textSecondary, fontSize: 13 }}>
                  {r.customerName} →{' '}
                  <Link href={`/providers/${r.provider.id}`}>{r.provider.displayName}</Link> ·{' '}
                  <Link href={`/jobs/${r.jobId}`}>iş</Link> · {formatDate(r.createdAt)}
                  {r.updatedAt !== r.createdAt ? ` · düzenlendi ${formatDate(r.updatedAt)}` : ''}
                </span>
              </div>
              <div style={{ display: 'flex', gap: spacing.md, flexWrap: 'wrap', fontSize: 13 }}>
                {SUB_RATINGS.map(([key, label]) =>
                  r[key] === null ? null : (
                    <span key={key}>
                      {label}: {r[key]}/5
                    </span>
                  ),
                )}
              </div>
              {r.comment ? <p style={{ whiteSpace: 'pre-wrap' }}>“{r.comment}”</p> : null}
              {r.moderationReason ? (
                <p style={{ fontSize: 13, color: colors.textSecondary }}>
                  Son moderasyon: {r.moderationReason} · {formatDate(r.moderatedAt)}
                </p>
              ) : null}
              <div style={{ maxWidth: 480 }}>
                <ModerationForm
                  action={moderateReview}
                  hidden={{ id: r.id, decision: r.status === 'HIDDEN' ? 'restore' : 'hide' }}
                  submitLabel={r.status === 'HIDDEN' ? 'Yayına geri al' : 'Gizle'}
                  tone={r.status === 'HIDDEN' ? 'primary' : 'danger'}
                  label={
                    r.status === 'HIDDEN' ? 'Değerlendirmeyi geri al' : 'Değerlendirmeyi gizle'
                  }
                >
                  <input
                    name="reason"
                    required
                    minLength={3}
                    maxLength={500}
                    placeholder="Gerekçe (denetim kaydına yazılır)"
                    aria-label="Gerekçe"
                  />
                </ModerationForm>
              </div>
            </article>
          ))}
        </div>
      )}
      {nextCursor ? (
        <Link href={`/reviews?${nextQuery.toString()}`} className="btn">
          Sonraki sayfa
        </Link>
      ) : null}
    </div>
  );
}
