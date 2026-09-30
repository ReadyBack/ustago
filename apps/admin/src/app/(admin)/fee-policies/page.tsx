import type { AdminFeePolicy } from '@ustago/types';
import { formatBps, formatMoney } from '@ustago/validation';
import { colors, spacing } from '@ustago/ui';
import Link from 'next/link';
import { z } from 'zod';

import { FeePolicyPill } from '@/components/trust-pills';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { formatDate } from '@/lib/labels';
import { adminFeePolicySchema, feePreviewLineSchema } from '@/lib/schemas';
import { parsePreviewBps } from '@/lib/trust-filters';

import { ModerationForm } from '../moderation-form';
import { createFeePolicy, decideFeePolicy } from '../ops-actions';

const DEFAULT_PREVIEW_BPS = 1000;

export default async function FeePoliciesPage(props: PageProps<'/fee-policies'>) {
  const requested = parsePreviewBps(await props.searchParams);
  await requireAdmin(`/fee-policies${requested === null ? '' : `?bps=${requested}`}`);

  const policies = await apiRequest('/admin/fee-policies', {
    schema: z.array(adminFeePolicySchema),
  });
  const active = policies.ok ? policies.data.find((p) => p.lifecycle === 'ACTIVE') : undefined;
  const bps = requested ?? active?.bps ?? DEFAULT_PREVIEW_BPS;
  const preview = await apiRequest(`/admin/fee-policies/preview?bps=${bps}`, {
    schema: z.array(feePreviewLineSchema),
  });

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <h1>Komisyon politikaları</h1>
      <p className="muted">
        Yeni politika taslak olarak başlar ve yayınlanana kadar hiçbir işe uygulanmaz. Yayınlanan
        politika değiştirilemez; başlangıç zamanı gelecekte olmalıdır. Fiyatı belirlenmiş işler
        kendi komisyon kayıtlarını korur, geriye dönük komisyon uygulanmaz.
      </p>

      {!policies.ok ? (
        <p role="alert">{policies.message}</p>
      ) : policies.data.length === 0 ? (
        <p className="card">Politika yok.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Politika</th>
                <th>Oran</th>
                <th>Durum</th>
                <th>Başlangıç</th>
                <th>Kullanan iş</th>
                <th>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {policies.data.map((p) => (
                <PolicyRow key={p.id} p={p} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="grid-2">
        <div className="card" style={{ display: 'grid', gap: spacing.md }}>
          <h2>Komisyon önizlemesi</h2>
          <form method="get" className="filters" aria-label="Önizleme oranı">
            <label>
              Oran (%)
              <input
                name="rate"
                inputMode="decimal"
                defaultValue={formatBps(bps).slice(1)}
                style={{ minHeight: 40, padding: 8 }}
              />
            </label>
            <div style={{ display: 'flex', alignItems: 'end' }}>
              <button type="submit" className="btn">
                Önizle
              </button>
            </div>
          </form>
          {!preview.ok ? (
            <p role="alert">{preview.message}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>İş tutarı</th>
                  <th>Komisyon ({formatBps(bps)})</th>
                  <th>Usta neti</th>
                </tr>
              </thead>
              <tbody>
                {preview.data.map((line) => (
                  <tr key={line.gross.amountMinor}>
                    <td>{formatMoney(line.gross)}</td>
                    <td>{formatMoney(line.fee)}</td>
                    <td>
                      <strong>{formatMoney(line.providerNet)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h2>Yeni taslak</h2>
          <ModerationForm
            action={createFeePolicy}
            hidden={{}}
            submitLabel="Taslak oluştur"
            tone="primary"
            label="Yeni komisyon politikası"
            doneMessage="Taslak oluşturuldu. Yayınlamadan önce önizlemeyi kontrol edin."
          >
            <label className="field">
              Kod
              <input
                name="code"
                required
                maxLength={60}
                pattern="[a-z0-9][a-z0-9\-]{2,59}"
                placeholder="ör. standart-2026-11"
                autoComplete="off"
              />
            </label>
            <label className="field">
              Ad
              <input name="name" required minLength={3} maxLength={120} />
            </label>
            <label className="field">
              Oran (%)
              <input name="rate" required inputMode="decimal" placeholder="ör. 10 veya 12,5" />
            </label>
            <label className="field">
              Başlangıç (İstanbul saati)
              <input type="datetime-local" name="effectiveFrom" required />
            </label>
          </ModerationForm>
        </div>
      </section>
    </div>
  );
}

function PolicyRow({ p }: { p: AdminFeePolicy }) {
  return (
    <tr>
      <td>
        <strong>{p.name}</strong>
        <div className="muted">
          <code>{p.code}</code>
          {p.isDevelopment ? ' · geliştirme' : ''}
        </div>
      </td>
      <td>
        <Link href={`/fee-policies?bps=${p.bps}`}>{formatBps(p.bps)}</Link>
        {p.fixed.amountMinor > 0 ? <div className="muted">+ {formatMoney(p.fixed)}</div> : null}
        {p.min || p.max ? (
          <div className="muted">
            {p.min ? `en az ${formatMoney(p.min)}` : ''}
            {p.min && p.max ? ', ' : ''}
            {p.max ? `en çok ${formatMoney(p.max)}` : ''}
          </div>
        ) : null}
      </td>
      <td>
        <FeePolicyPill lifecycle={p.lifecycle} />
        {p.publishedAt ? (
          <div className="muted">
            Yayınlayan: {p.publishedBy?.name ?? '—'} · {formatDate(p.publishedAt)}
          </div>
        ) : null}
        {p.retiredAt ? <div className="muted">Kalktı: {formatDate(p.retiredAt)}</div> : null}
      </td>
      <td>{formatDate(p.effectiveFrom)}</td>
      <td>{p.jobsUsing}</td>
      <td style={{ minWidth: 240 }}>
        {p.lifecycle === 'DRAFT' ? (
          <div style={{ display: 'grid', gap: spacing.sm }}>
            <ModerationForm
              action={decideFeePolicy}
              hidden={{ id: p.id, decision: 'publish' }}
              submitLabel="Yayınla"
              tone="primary"
              label="Politikayı yayınla"
              doneMessage="Yayınlandı."
            >
              <label className="check">
                <input type="checkbox" name="confirm" value="yes" required />
                {formatBps(p.bps)} oranı {formatDate(p.effectiveFrom)} itibarıyla yeni işlere
                uygulanacak; yayınlanan politika değiştirilemez.
              </label>
            </ModerationForm>
            <ModerationForm
              action={decideFeePolicy}
              hidden={{ id: p.id, decision: 'delete' }}
              submitLabel="Taslağı sil"
              tone="danger"
              label="Taslağı sil"
            />
          </div>
        ) : p.lifecycle === 'SCHEDULED' ? (
          <ModerationForm
            action={decideFeePolicy}
            hidden={{ id: p.id, decision: 'retire' }}
            submitLabel="Planı iptal et"
            tone="danger"
            label="Planlanmış politikayı iptal et"
            doneMessage="İptal edildi."
          >
            <label className="check">
              <input type="checkbox" name="confirm" value="yes" required />
              Bu politika hiç yürürlüğe girmeyecek.
            </label>
          </ModerationForm>
        ) : p.lifecycle === 'ACTIVE' ? (
          <span className="muted" style={{ color: colors.textSecondary }}>
            Değiştirmek için yeni bir politika yayınlayın.
          </span>
        ) : null}
      </td>
    </tr>
  );
}
