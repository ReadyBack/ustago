import { provinceSchema } from '@ustago/validation';
import { spacing } from '@ustago/ui';
import Link from 'next/link';
import { z } from 'zod';

import { ApiErrorNotice } from '@/components/api-error';
import { LaunchStatusPill } from '@/components/launch-status-pill';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { LAUNCH_STATUS_HINTS, LAUNCH_STATUS_LABELS } from '@/lib/labels';
import { LAUNCH_STATUSES } from '@/lib/marketplace';

import { LaunchStatusControl } from './launch-status-control';

export default async function ProvinceLaunchPage() {
  await requireAdmin('/marketplace/provinces');
  const result = await apiRequest('/locations/provinces', { schema: z.array(provinceSchema) });

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <h1>İl açılışları</h1>
      <section className="card">
        <dl>
          {LAUNCH_STATUSES.map((s) => (
            <div key={s} style={{ display: 'contents' }}>
              <dt>{LAUNCH_STATUS_LABELS[s]}</dt>
              <dd>{LAUNCH_STATUS_HINTS[s]}</dd>
            </div>
          ))}
        </dl>
      </section>

      {!result.ok ? (
        <ApiErrorNotice error={result} what="İl listesi" />
      ) : result.data.length === 0 ? (
        <p className="card">İl bulunamadı.</p>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Plaka</th>
                <th>İl</th>
                <th>Durum</th>
                <th>Değiştir</th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((p) => (
                <tr key={p.id}>
                  <td>{String(p.id).padStart(2, '0')}</td>
                  <td>
                    <Link href={`/marketplace/regions?provinceId=${p.id}`}>{p.name}</Link>
                  </td>
                  <td>
                    <LaunchStatusPill status={p.launchStatus} />
                  </td>
                  <td>
                    <LaunchStatusControl
                      provinceId={p.id}
                      provinceName={p.name}
                      current={p.launchStatus}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
