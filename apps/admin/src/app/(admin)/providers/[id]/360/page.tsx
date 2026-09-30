import type { AdminProvider360 } from '@ustago/types';
import {
  formatMoney,
  providerQualitySchema,
  SUSPENSION_REASON_CODES,
  uuidSchema,
} from '@ustago/validation';
import { colors, spacing } from '@ustago/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AuditTable } from '@/components/audit-table';
import { ProviderStatusPill } from '@/components/status-pill';
import {
  AccountStatusPill,
  FlagPill,
  SuspensionStatusPill,
  VerificationCasePill,
} from '@/components/trust-pills';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import {
  EARNING_STATUS_LABELS,
  formatDate,
  JOB_STATUS_LABELS,
  labelOf,
  PAYOUT_STATUS_LABELS,
  PENALTY_STATUS_LABELS,
  PENALTY_TYPE_LABELS,
  REVIEW_STATUS_LABELS,
  SUSPENSION_LEVEL_LABELS,
  SUSPENSION_REASON_LABELS,
} from '@/lib/labels';
import { adminProvider360Schema, adminVerificationCaseDetailSchema } from '@/lib/schemas';
import { type Provider360Tab, PROVIDER_360_TABS, parseProvider360Tab } from '@/lib/trust-filters';

import { ModerationForm } from '../../../moderation-form';
import { liftSuspension, suspendProvider } from '../../../trust-actions';
import { QualityCard } from '../quality-card';

const DESTINATION_LABELS = {
  UNVERIFIED: 'Doğrulanmadı',
  PENDING_VERIFICATION: 'Doğrulama bekliyor',
  VERIFIED: 'Doğrulandı',
} as const;

export default async function Provider360Page(props: PageProps<'/providers/[id]/360'>) {
  const [{ id: rawId }, params] = await Promise.all([props.params, props.searchParams]);
  const id = uuidSchema.safeParse(rawId);
  if (!id.success) notFound();
  const tab = parseProvider360Tab(params);
  await requireAdmin(`/providers/${id.data}/360?tab=${tab}`);

  const result = await apiRequest(`/admin/providers/${id.data}/360`, {
    schema: adminProvider360Schema,
  });
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <p role="alert">{result.message}</p>;
  }
  const p = result.data;

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <Link href={`/providers/${p.providerId}`}>← Başvuru sayfası</Link>
      <header style={{ display: 'flex', gap: spacing.md, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1>{p.displayName}</h1>
        <ProviderStatusPill status={p.applicationStatus} />
        <VerificationCasePill status={p.verificationStatus} />
        <AccountStatusPill status={p.accountStatus} />
      </header>
      <nav className="tabs" aria-label="Usta 360">
        {PROVIDER_360_TABS.map((t) => (
          <Link
            key={t.key}
            href={`/providers/${p.providerId}/360?tab=${t.key}`}
            className={`tab${t.key === tab ? ' tab-active' : ''}`}
            aria-current={t.key === tab ? 'page' : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <TabContent tab={tab} p={p} />
    </div>
  );
}

async function TabContent({ tab, p }: { tab: Provider360Tab; p: AdminProvider360 }) {
  switch (tab) {
    case 'overview':
      return <Overview p={p} />;
    case 'verification':
      return <Verification p={p} />;
    case 'jobs':
      return <Jobs p={p} />;
    case 'reviews':
      return <Reviews p={p} />;
    case 'quality':
      return <Quality p={p} />;
    case 'finance':
      return <Finance p={p} />;
    case 'sanctions':
      return <Sanctions p={p} />;
    case 'audit':
      return <Audit p={p} />;
  }
}

function Overview({ p }: { p: AdminProvider360 }) {
  const c = p.capabilities;
  const caps: [string, boolean][] = [
    ['Aramada görünür', c.listed],
    ['Teklif verebilir', c.canQuote],
    ['Acil (NOW) iş alabilir', c.canTakeNowJobs],
    ['Para çekebilir', c.canRequestPayout],
    ['Doğrulanmış rozeti', c.showVerifiedBadge],
  ];
  return (
    <section className="grid-2">
      <div className="card">
        <h2>İletişim</h2>
        <dl>
          <dt>Ad soyad</dt>
          <dd>{p.contact.name}</dd>
          <dt>Telefon</dt>
          <dd>{p.contact.phone ?? '—'}</dd>
          <dt>E-posta</dt>
          <dd>{p.contact.email ?? '—'}</dd>
          <dt>Kayıt</dt>
          <dd>{formatDate(p.createdAt)}</dd>
          <dt>Toplam iş</dt>
          <dd>{p.jobs.total}</dd>
          <dt>Puan</dt>
          <dd>
            {p.reviews.average === null
              ? 'Değerlendirme yok'
              : `${p.reviews.average.toFixed(1)} / 5 (${p.reviews.published})`}
          </dd>
          <dt>UstaScore</dt>
          <dd>{p.quality.ustaScore === null ? '—' : p.quality.ustaScore.toFixed(1)}</dd>
        </dl>
      </div>
      <div className="card">
        <h2>Şu an yapabildikleri</h2>
        <dl>
          {caps.map(([label, on]) => (
            <div key={label} style={{ display: 'contents' }}>
              <dt>{label}</dt>
              <dd>
                <FlagPill on={on} label={on ? 'Evet' : 'Hayır'} />
              </dd>
            </div>
          ))}
        </dl>
        {c.restrictions.length > 0 ? (
          <>
            <h3>Kısıtlamalar</h3>
            <ul>
              {c.restrictions.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </section>
  );
}

async function Verification({ p }: { p: AdminProvider360 }) {
  const detail = await apiRequest(`/admin/verification-cases/${p.providerId}`, {
    schema: adminVerificationCaseDetailSchema,
  });
  return (
    <section className="card" style={{ display: 'grid', gap: spacing.md }}>
      <h2>Hesap doğrulama</h2>
      <p>
        Durum: <VerificationCasePill status={p.verificationStatus} />
      </p>
      {detail.ok ? (
        <>
          <dl>
            <dt>Gönderildi</dt>
            <dd>{formatDate(detail.data.submittedAt)}</dd>
            <dt>Son karar</dt>
            <dd>
              {detail.data.decisionBy?.name ?? '—'} · {formatDate(detail.data.decidedAt)}
            </dd>
            <dt>Belgeler</dt>
            <dd>{detail.data.documents.length}</dd>
            <dt>Ustaya açıklama</dt>
            <dd>{detail.data.userVisibleReason ?? '—'}</dd>
          </dl>
          <ul className="checklist">
            {detail.data.checklist.map((item) => (
              <li key={item.key} data-done={item.done}>
                {item.done ? '✓' : '○'} {item.label}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p role="alert">{detail.message}</p>
      )}
      <p>
        <Link href={`/verifications/cases/${p.providerId}`} className="btn btn-primary">
          Doğrulama talebini aç
        </Link>
      </p>
    </section>
  );
}

function Jobs({ p }: { p: AdminProvider360 }) {
  return (
    <section className="grid-2">
      <div className="card">
        <h2>Durumlara göre ({p.jobs.total})</h2>
        {Object.keys(p.jobs.byStatus).length === 0 ? <p>İş yok.</p> : null}
        <dl>
          {Object.entries(p.jobs.byStatus).map(([status, count]) => (
            <div key={status} style={{ display: 'contents' }}>
              <dt>{labelOf(JOB_STATUS_LABELS, status)}</dt>
              <dd>
                <Link href={`/jobs?providerId=${p.providerId}&status=${status}`}>{count}</Link>
              </dd>
            </div>
          ))}
        </dl>
        <p style={{ marginTop: spacing.md }}>
          <Link href={`/jobs?providerId=${p.providerId}`}>Tüm işler</Link>
        </p>
      </div>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <h2 style={{ padding: `${spacing.md}px ${spacing.md}px 0` }}>Son işler</h2>
        <table>
          <thead>
            <tr>
              <th>Tarih</th>
              <th>Durum</th>
              <th>Tutar</th>
            </tr>
          </thead>
          <tbody>
            {p.jobs.recent.map((j) => (
              <tr key={j.id}>
                <td>
                  <Link href={`/jobs/${j.id}`}>{formatDate(j.createdAt)}</Link>
                </td>
                <td>{labelOf(JOB_STATUS_LABELS, j.status)}</td>
                <td>{formatMoney(j.currentTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Reviews({ p }: { p: AdminProvider360 }) {
  return (
    <section className="card" style={{ display: 'grid', gap: spacing.md }}>
      <h2>Yorumlar</h2>
      <dl>
        <dt>Ortalama</dt>
        <dd>{p.reviews.average === null ? '—' : `${p.reviews.average.toFixed(1)} / 5`}</dd>
        <dt>Yayında</dt>
        <dd>{p.reviews.published}</dd>
        <dt>Gizli / inceleniyor</dt>
        <dd>{p.reviews.hidden}</dd>
      </dl>
      {p.reviews.recent.length === 0 ? (
        <p>Değerlendirme yok.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Tarih</th>
              <th>Puan</th>
              <th>Yorum</th>
              <th>Durum</th>
            </tr>
          </thead>
          <tbody>
            {p.reviews.recent.map((r) => (
              <tr key={r.id}>
                <td>{formatDate(r.createdAt)}</td>
                <td>{'★'.repeat(r.rating)}</td>
                <td style={{ whiteSpace: 'pre-wrap' }}>{r.comment ?? '—'}</td>
                <td>{labelOf(REVIEW_STATUS_LABELS, r.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Link href={`/reviews?providerId=${p.providerId}`}>Tüm değerlendirmeler ve moderasyon</Link>
    </section>
  );
}

async function Quality({ p }: { p: AdminProvider360 }) {
  const quality = await apiRequest(`/admin/providers/${p.providerId}/quality`, {
    schema: providerQualitySchema,
  });
  return quality.ok ? (
    <QualityCard quality={quality.data} />
  ) : (
    <p role="alert">Kalite bilgisi alınamadı: {quality.message}</p>
  );
}

function Finance({ p }: { p: AdminProvider360 }) {
  const f = p.finance;
  return (
    <section className="grid-2">
      <div className="card">
        <h2>Kazançlar (net)</h2>
        {Object.keys(f.earningsByStatus).length === 0 ? <p>Kazanç kaydı yok.</p> : null}
        <dl>
          {Object.entries(f.earningsByStatus).map(([status, money]) => (
            <div key={status} style={{ display: 'contents' }}>
              <dt>{labelOf(EARNING_STATUS_LABELS, status)}</dt>
              <dd>{formatMoney(money)}</dd>
            </div>
          ))}
        </dl>
        <h3>Banka hesabı</h3>
        {f.destination ? (
          <p>
            <span style={{ fontFamily: 'monospace' }}>{f.destination.maskedIban}</span> ·{' '}
            {DESTINATION_LABELS[f.destination.verificationStatus]}
            {f.destination.isTest ? (
              <>
                {' '}
                <span className="pill pill-warning">Test hesabı</span>
              </>
            ) : null}
          </p>
        ) : (
          <p>Hesap eklenmemiş.</p>
        )}
        <p style={{ marginTop: spacing.md }}>
          <Link href={`/finance/ledger?providerId=${p.providerId}`}>Defter kayıtları</Link>
        </p>
      </div>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <h2 style={{ padding: `${spacing.md}px ${spacing.md}px 0` }}>Son para çekme talepleri</h2>
        {f.recentPayouts.length === 0 ? (
          <p style={{ padding: spacing.md }}>Talep yok.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Tarih</th>
                <th>Tutar</th>
                <th>Durum</th>
              </tr>
            </thead>
            <tbody>
              {f.recentPayouts.map((po) => (
                <tr key={po.id}>
                  <td>{formatDate(po.createdAt)}</td>
                  <td>{formatMoney(po.amount)}</td>
                  <td>
                    <Link href={`/finance/payouts?status=${po.status}`}>
                      {labelOf(PAYOUT_STATUS_LABELS, po.status)}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function Sanctions({ p }: { p: AdminProvider360 }) {
  const open = p.suspensions.find(
    (s) => s.status === 'ACTIVE' || s.status === 'EXPIRED_PENDING_REVIEW',
  );
  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <section className="card" style={{ display: 'grid', gap: spacing.md }}>
        <h2>Hesap askıları</h2>
        {p.suspensions.length === 0 ? (
          <p className="muted">Askı kaydı yok.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Tür</th>
                  <th>Durum</th>
                  <th>Gerekçe</th>
                  <th>Süre</th>
                  <th>Karar</th>
                </tr>
              </thead>
              <tbody>
                {p.suspensions.map((s) => (
                  <tr key={s.id}>
                    <td>{SUSPENSION_LEVEL_LABELS[s.level]}</td>
                    <td>
                      <SuspensionStatusPill status={s.status} />
                    </td>
                    <td>
                      {labelOf(SUSPENSION_REASON_LABELS, s.reasonCode)}
                      <div>{s.userVisibleReason}</div>
                      {s.internalNote ? (
                        <div className="muted">İç not: {s.internalNote}</div>
                      ) : null}
                    </td>
                    <td>
                      {formatDate(s.startsAt)} →{' '}
                      {s.expiresAt ? formatDate(s.expiresAt) : 'kaldırılana kadar'}
                      {s.expiresAt ? (
                        <div className="muted">
                          {s.autoLift ? 'Süre bitince otomatik kalkar' : 'Süre bitince incelenir'}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {s.createdBy?.name ?? '—'}
                      {s.liftedAt ? (
                        <div className="muted">
                          Kaldıran: {s.liftedBy?.name ?? '—'} · {formatDate(s.liftedAt)}
                          {s.liftNote ? ` · ${s.liftNote}` : ''}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {open ? (
          <div style={{ maxWidth: 520 }}>
            <h3>Askıyı kaldır</h3>
            <ModerationForm
              action={liftSuspension}
              hidden={{ providerId: p.providerId }}
              submitLabel="Askıyı kaldır"
              tone="primary"
              label="Askıyı kaldır"
              doneMessage="Askı kaldırıldı; ustaya bildirim gönderildi."
            >
              <label className="field">
                Kaldırma notu
                <textarea name="note" required minLength={5} maxLength={1000} rows={2} />
              </label>
            </ModerationForm>
          </div>
        ) : (
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Hesabı askıya al</summary>
            <div style={{ maxWidth: 520, marginTop: spacing.sm }}>
              <ModerationForm
                action={suspendProvider}
                hidden={{ providerId: p.providerId }}
                submitLabel="Askıya al"
                tone="danger"
                label="Hesabı askıya al"
                doneMessage="Hesap askıya alındı."
              >
                <label className="field">
                  Tür
                  <select name="level" defaultValue="SUSPENDED">
                    <option value="SUSPENDED">{SUSPENSION_LEVEL_LABELS.SUSPENDED}</option>
                    <option value="BANNED">{SUSPENSION_LEVEL_LABELS.BANNED}</option>
                  </select>
                </label>
                <label className="field">
                  Gerekçe kodu
                  <select name="reasonCode" required defaultValue="">
                    <option value="" disabled>
                      Seçin
                    </option>
                    {SUSPENSION_REASON_CODES.map((code) => (
                      <option key={code} value={code}>
                        {SUSPENSION_REASON_LABELS[code]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Ustaya gösterilecek açıklama
                  <textarea
                    name="userVisibleReason"
                    required
                    minLength={5}
                    maxLength={500}
                    rows={3}
                  />
                </label>
                <label className="field">
                  İç not (isteğe bağlı)
                  <textarea name="internalNote" maxLength={2000} rows={2} />
                </label>
                <label className="field">
                  Son gün (boş: kaldırılana kadar; kalıcı kapatmada boş bırakın)
                  <input type="date" name="expiresOn" />
                </label>
                <label className="check">
                  <input type="checkbox" name="autoLift" value="yes" />
                  Süre bitince otomatik kaldır (işaretlenmezse bir yönetici inceler)
                </label>
                <p className="muted">
                  Askıdaki usta yeni teklif veremez, acil iş alamaz ve para çekemez. Mevcut işler ve
                  geçmiş korunur.
                </p>
              </ModerationForm>
            </div>
          </details>
        )}
      </section>

      <section className="card" style={{ display: 'grid', gap: spacing.md }}>
        <h2>Yaptırımlar</h2>
        {p.penalties.length === 0 ? (
          <p className="muted">Yaptırım yok.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Tür</th>
                <th>Durum</th>
                <th>Kod</th>
                <th>Süre</th>
              </tr>
            </thead>
            <tbody>
              {p.penalties.map((pen) => (
                <tr key={pen.id}>
                  <td>{labelOf(PENALTY_TYPE_LABELS, pen.type)}</td>
                  <td>{labelOf(PENALTY_STATUS_LABELS, pen.status)}</td>
                  <td>
                    <code>{pen.reasonCode}</code>
                  </td>
                  <td>
                    {formatDate(pen.startsAt)} →{' '}
                    {pen.endsAt ? formatDate(pen.endsAt) : 'kaldırılana kadar'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted" style={{ color: colors.textSecondary }}>
          Yaptırım vermek ve kaldırmak için{' '}
          <Link href={`/providers/${p.providerId}/360?tab=quality`}>Kalite</Link> sekmesini
          kullanın.
        </p>
      </section>
    </div>
  );
}

function Audit({ p }: { p: AdminProvider360 }) {
  return (
    <section className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <h2 style={{ padding: `${spacing.md}px ${spacing.md}px 0` }}>Son denetim kayıtları</h2>
      {p.audit.length === 0 ? (
        <p style={{ padding: spacing.md }}>Kayıt yok.</p>
      ) : (
        <AuditTable events={p.audit} />
      )}
      <p style={{ padding: spacing.md }}>
        <Link href={`/audit?entityId=${p.providerId}`}>Tüm kayıtlar</Link>
      </p>
    </section>
  );
}
