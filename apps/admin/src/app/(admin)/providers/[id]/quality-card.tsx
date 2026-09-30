import type { ProviderQuality } from '@ustago/types';
import { colors, spacing } from '@ustago/ui';
import Link from 'next/link';

import {
  formatDate,
  PENALTY_SEVERITY_LABELS,
  PENALTY_STATUS_LABELS,
  PENALTY_TYPE_LABELS,
  PENALTY_TYPES,
  QUALITY_FACTOR_LABELS,
} from '@/lib/labels';

import { createPenalty, revokePenalty } from '../../moderation-actions';
import { ModerationForm } from '../../moderation-form';

const pct = (n: number) => `%${Math.round(n * 100)}`;

/** UstaScore breakdown, counts attributed to the right party, and admin penalties. */
export function QualityCard({ quality: q }: { quality: ProviderQuality }) {
  const muted = { color: colors.textSecondary, fontSize: 13 };
  return (
    <section className="card" style={{ display: 'grid', gap: spacing.md }} aria-label="Kalite">
      <h2>Kalite ve UstaScore</h2>
      <div className="grid-2">
        <dl>
          <dt>UstaScore</dt>
          <dd>
            <strong style={{ fontSize: 20 }}>
              {q.ustaScore === null ? '—' : q.ustaScore.toFixed(1)}
            </strong>
            {q.isNewProvider ? ' · Yeni Usta (yeterli veri yok)' : ''}
          </dd>
          <dt>Puan ortalaması</dt>
          <dd>
            {q.ratingAverage === null
              ? 'Değerlendirme yok'
              : `${q.ratingAverage.toFixed(1)} / 5 (${q.reviewCount} değerlendirme)`}
          </dd>
          <dt>Tamamlanan iş</dt>
          <dd>
            <Link href={`/jobs?providerId=${q.providerId}&status=COMPLETED`}>
              {q.completedJobs}
            </Link>
          </dd>
          <dt>Usta kaynaklı iptal</dt>
          <dd>{q.providerCancelledJobs}</dd>
          <dt>Müşteri kaynaklı iptal</dt>
          <dd>
            {q.customerCancelledJobs} <span style={muted}>(ustaya yazılmaz)</span>
          </dd>
          <dt>Açık sorun bildirimi</dt>
          <dd>{q.openDisputes}</dd>
          <dt>Yaptırım puanı</dt>
          <dd>{q.penaltyPoints > 0 ? `−${q.penaltyPoints}` : '0'}</dd>
          <dt>Hesaplama</dt>
          <dd>
            {q.algorithmVersion ?? '—'} · {formatDate(q.computedAt)}
          </dd>
        </dl>
        <table>
          <thead>
            <tr>
              <th>Etken</th>
              <th>Ağırlık</th>
              <th>Puan</th>
            </tr>
          </thead>
          <tbody>
            {q.factors.map((f) => (
              <tr key={f.key}>
                <td>
                  {QUALITY_FACTOR_LABELS[f.key]}
                  <div style={muted}>{f.detail}</div>
                </td>
                <td>
                  {pct(f.weight)}
                  {f.score === null ? (
                    <div style={muted}>veri yok</div>
                  ) : f.effectiveWeight !== f.weight ? (
                    <div style={muted}>etkin {pct(f.effectiveWeight)}</div>
                  ) : null}
                </td>
                <td>{f.score === null ? '—' : Math.round(f.score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Yaptırımlar</h3>
      {q.penalties.length === 0 ? (
        <p style={muted}>Yaptırım yok.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Tür</th>
              <th>Durum</th>
              <th>Gerekçe</th>
              <th>Süre</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {q.penalties.map((p) => (
              <tr key={p.id}>
                <td>
                  {PENALTY_TYPE_LABELS[p.type]}
                  <div style={muted}>{PENALTY_SEVERITY_LABELS[p.severity]}</div>
                </td>
                <td>{PENALTY_STATUS_LABELS[p.status]}</td>
                <td>
                  <code>{p.reasonCode}</code>
                  <div>{p.reason}</div>
                  <div style={muted}>{p.decidedBy?.name ?? '—'}</div>
                </td>
                <td>
                  {formatDate(p.startsAt)} → {p.endsAt ? formatDate(p.endsAt) : 'kaldırılana kadar'}
                </td>
                <td style={{ minWidth: 220 }}>
                  {p.status === 'ACTIVE' ? (
                    <ModerationForm
                      action={revokePenalty}
                      hidden={{ id: p.id, providerId: q.providerId }}
                      submitLabel="Kaldır"
                      label="Yaptırımı kaldır"
                    >
                      <input
                        name="reason"
                        required
                        minLength={3}
                        maxLength={500}
                        placeholder="Kaldırma gerekçesi"
                        aria-label="Kaldırma gerekçesi"
                      />
                    </ModerationForm>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <details>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Yaptırım ver</summary>
        <div style={{ maxWidth: 520, marginTop: spacing.sm }}>
          <ModerationForm
            action={createPenalty}
            hidden={{ providerId: q.providerId }}
            submitLabel="Yaptırımı uygula"
            tone="danger"
            label="Yaptırım ver"
            doneMessage="Yaptırım kaydedildi; UstaScore yeniden hesaplandı."
          >
            <label>
              Tür
              <select name="type" required defaultValue="WARNING">
                {PENALTY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PENALTY_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Kod
              <input name="reasonCode" required placeholder="ör. NO_SHOW" maxLength={60} />
            </label>
            <label>
              Gerekçe (ustaya gösterilir)
              <textarea name="reason" required minLength={10} maxLength={2000} rows={3} />
            </label>
            <label>
              Bitiş (boş: kaldırılana kadar)
              <input type="date" name="endsOn" />
            </label>
            <p style={muted}>
              Hesabı askıya almak ayrı bir karardır; aşağıdaki “Karar” bölümünden yapılır.
            </p>
          </ModerationForm>
        </div>
      </details>
    </section>
  );
}
