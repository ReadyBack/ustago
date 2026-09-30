import type { RuntimeFlagView } from '@ustago/types';
import { formatMoney } from '@ustago/validation';
import { colors, spacing } from '@ustago/ui';
import Link from 'next/link';
import { z } from 'zod';

import {
  ComponentStatePill,
  FlagPill,
  RunStatusPill,
  WorkerHealthPill,
} from '@/components/trust-pills';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { COMPONENT_LABELS, formatDate } from '@/lib/labels';
import { adminOperationsStatusSchema, runtimeFlagSchema } from '@/lib/schemas';

import { ModerationForm } from '../moderation-form';
import { runOpsMonitor, setRuntimeFlag } from '../ops-actions';

const ENVIRONMENT_LABELS = {
  development: 'Geliştirme',
  test: 'Test',
  staging: 'Ön yayın',
  production: 'Canlı',
} as const;

export default async function OperationsPage() {
  await requireAdmin('/operations');
  const [status, flags] = await Promise.all([
    apiRequest('/admin/ops/status', { schema: adminOperationsStatusSchema }),
    apiRequest('/admin/runtime-flags', { schema: z.array(runtimeFlagSchema) }),
  ]);

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <header style={{ display: 'flex', gap: spacing.md, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1>Operasyon</h1>
        {status.ok ? (
          <span className="pill pill-neutral">
            {ENVIRONMENT_LABELS[status.data.environment]} · {status.data.version}
          </span>
        ) : null}
      </header>

      {!status.ok ? (
        <p role="alert">{status.message}</p>
      ) : (
        <>
          <section className="grid-2">
            <div className="card">
              <h2>Bileşenler</h2>
              <dl>
                {(Object.keys(COMPONENT_LABELS) as (keyof typeof COMPONENT_LABELS)[]).map((k) => (
                  <div key={k} style={{ display: 'contents' }}>
                    <dt>{COMPONENT_LABELS[k]}</dt>
                    <dd>
                      <ComponentStatePill state={status.data.components[k]} />
                    </dd>
                  </div>
                ))}
                <dt>Ölçüm</dt>
                <dd>{formatDate(status.data.checkedAt)}</dd>
              </dl>
            </div>
            <div className="card">
              <h2>Kuyruklar ve uyarılar</h2>
              <dl>
                <dt>Açık uyarı</dt>
                <dd>
                  <Link href="/operations/alerts">
                    {status.data.openAlerts.critical} kritik · {status.data.openAlerts.warning}{' '}
                    uyarı · {status.data.openAlerts.info} bilgi
                  </Link>
                </dd>
                <dt>Sonucu bilinmeyen para çekme</dt>
                <dd>
                  <Link href="/finance/payouts?status=NEEDS_RECONCILIATION">
                    {status.data.payouts.needsReconciliation}
                  </Link>
                </dd>
                <dt>Onay bekleyen para çekme</dt>
                <dd>
                  <Link href="/finance/payouts?status=REQUESTED">
                    {status.data.payouts.requested}
                  </Link>
                </dd>
                <dt>Bildirim kuyruğu</dt>
                <dd>
                  {status.data.pushOutbox.pending} bekliyor · {status.data.pushOutbox.failed}{' '}
                  başarısız
                  {status.data.pushOutbox.oldestPendingAgeSeconds !== null
                    ? ` · en eski ${Math.round(status.data.pushOutbox.oldestPendingAgeSeconds / 60)} dk`
                    : ''}
                </dd>
                <dt>Webhook (24 saat)</dt>
                <dd>
                  {status.data.webhooks.received24h} alındı · {status.data.webhooks.ignored24h} yok
                  sayıldı
                </dd>
                <dt>Webhook (bu süreç)</dt>
                <dd>
                  {status.data.webhooks.rejectedSinceStart} imza reddi ·{' '}
                  {status.data.webhooks.duplicatesSinceStart} tekrar
                </dd>
              </dl>
            </div>
          </section>

          <section className="card">
            <h2>Son mutabakat</h2>
            {status.data.latestReconciliation ? (
              <p>
                <RunStatusPill status={status.data.latestReconciliation.status} />{' '}
                {formatDate(status.data.latestReconciliation.startedAt)} ·{' '}
                {status.data.latestReconciliation.mismatchCount === 0 ? (
                  <span style={{ color: colors.success }}>uyumsuzluk yok</span>
                ) : (
                  <strong style={{ color: colors.emergency }}>
                    {status.data.latestReconciliation.mismatchCount} uyumsuzluk
                  </strong>
                )}
                {status.data.latestReconciliation.totals
                  ? ` · borç ${formatMoney(status.data.latestReconciliation.totals.debit)} / alacak ${formatMoney(status.data.latestReconciliation.totals.credit)}`
                  : ''}{' '}
                · <Link href="/operations/reconciliation">Geçmiş</Link>
              </p>
            ) : (
              <p>
                Henüz mutabakat çalıştırılmadı.{' '}
                <Link href="/operations/reconciliation">Şimdi çalıştır</Link>
              </p>
            )}
          </section>

          <section className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <h2 style={{ padding: `${spacing.md}px ${spacing.md}px 0` }}>Arka plan işleri</h2>
            <table>
              <thead>
                <tr>
                  <th>İş</th>
                  <th>Durum</th>
                  <th>Son başarılı</th>
                  <th>Son hata</th>
                  <th>Çalışma / hata</th>
                </tr>
              </thead>
              <tbody>
                {status.data.workers.map((w) => (
                  <tr key={w.name}>
                    <td>
                      <code>{w.name}</code>
                    </td>
                    <td>
                      <WorkerHealthPill health={w.health} />
                      {w.consecutiveFailures > 0 ? (
                        <div className="muted">{w.consecutiveFailures} ardışık hata</div>
                      ) : null}
                    </td>
                    <td>{formatDate(w.lastSuccessAt)}</td>
                    <td>
                      {formatDate(w.lastFailureAt)}
                      {w.lastError ? (
                        <div className="muted">
                          <code>{w.lastError}</code>
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {w.totalRuns} / {w.totalFailures}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card">
            <h2>Entegrasyonlar</h2>
            <ul>
              {status.data.integrations.map((i) => (
                <li key={i.name}>
                  {i.name}: <strong>{i.mode}</strong>{' '}
                  {i.productionReady ? null : (
                    <span className="pill pill-warning">Canlıya hazır değil</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <section className="card" style={{ display: 'grid', gap: spacing.md }}>
        <h2>Özellik anahtarları</h2>
        <p className="muted">
          Bir özelliğin çalışması için hem ortam ayarı hem yönetici anahtarı açık olmalı. Ortam
          ayarı yalnızca dağıtımla değişir. Anahtarı değiştirmek süper yönetici yetkisi, gerekçe ve
          onay ister; her değişiklik denetim kaydına yazılır.
        </p>
        {!flags.ok ? (
          <p role="alert">{flags.message}</p>
        ) : flags.data.length === 0 ? (
          <p>Anahtar yok.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Özellik</th>
                  <th>Etkin</th>
                  <th>Ortam / yönetici</th>
                  <th>Son değişiklik</th>
                  <th>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {flags.data.map((f) => (
                  <FlagRow key={f.key} f={f} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" style={{ maxWidth: 520 }}>
        <h2>İzleyiciyi şimdi çalıştır</h2>
        <p className="muted" style={{ marginBottom: spacing.sm }}>
          Kuyrukları, arka plan işlerini ve para çekmeleri kontrol edip gerekirse uyarı açar.
          Normalde zamanlanmış çalışır; yalnızca süper yönetici elle başlatabilir.
        </p>
        <ModerationForm
          action={runOpsMonitor}
          hidden={{}}
          submitLabel="İzleyiciyi çalıştır"
          label="İzleyiciyi çalıştır"
          doneMessage="İzleyici çalıştı; sonuçlar uyarılarda."
        />
      </section>
    </div>
  );
}

function FlagRow({ f }: { f: RuntimeFlagView }) {
  const target = !f.adminEnabled;
  return (
    <tr>
      <td>
        {f.label}
        <div className="muted">
          <code>{f.key}</code>
        </div>
      </td>
      <td>
        <FlagPill on={f.effective} />
      </td>
      <td>
        Ortam: {f.envEnabled ? 'açık' : 'kapalı'}
        <div>Yönetici: {f.adminEnabled ? 'açık' : 'kapalı'}</div>
      </td>
      <td>
        {f.updatedAt ? (
          <>
            {formatDate(f.updatedAt)}
            <div className="muted">
              {f.updatedBy?.name ?? '—'}
              {f.reason ? ` · ${f.reason}` : ''}
            </div>
          </>
        ) : (
          '—'
        )}
      </td>
      <td style={{ minWidth: 260 }}>
        <ModerationForm
          action={setRuntimeFlag}
          hidden={{ key: f.key, enabled: String(target) }}
          submitLabel={target ? 'Aç' : 'Kapat'}
          tone={target ? 'primary' : 'danger'}
          label={`${f.label}: ${target ? 'aç' : 'kapat'}`}
          doneMessage={target ? 'Açıldı.' : 'Kapatıldı.'}
        >
          <textarea
            name="reason"
            required
            minLength={5}
            maxLength={500}
            rows={2}
            placeholder="Gerekçe"
            aria-label="Gerekçe"
          />
          <label className="check">
            <input type="checkbox" name="confirm" value="yes" required />
            {target
              ? f.envEnabled
                ? 'Özelliği yeniden açmayı onaylıyorum.'
                : 'Onaylıyorum (ortam ayarı kapalı olduğu için özellik yine çalışmayacak).'
              : 'Özelliği tüm kullanıcılar için kapatmayı onaylıyorum.'}
          </label>
        </ModerationForm>
      </td>
    </tr>
  );
}
