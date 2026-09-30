import { paginatedSchema } from '@ustago/validation';
import { spacing } from '@ustago/ui';
import Link from 'next/link';

import { ApiErrorNotice } from '@/components/api-error';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { formatDate } from '@/lib/labels';
import {
  formatCount,
  formatMinutes,
  NO_OFFER_AGE_OPTIONS,
  parseCursor,
  parseOlderThan,
} from '@/lib/marketplace';
import { noOfferRequestRowSchema } from '@/lib/marketplace-schemas';

export default async function NoOfferPage(props: PageProps<'/marketplace/no-offer'>) {
  const params = await props.searchParams;
  const olderThanMinutes = parseOlderThan(params.olderThanMinutes);
  const cursor = parseCursor(params.cursor);
  const query = new URLSearchParams({ olderThanMinutes: String(olderThanMinutes) });
  if (cursor) query.set('cursor', cursor);
  await requireAdmin(`/marketplace/no-offer?${query.toString()}`);

  const result = await apiRequest(`/admin/marketplace/no-offer?${query.toString()}&limit=50`, {
    schema: paginatedSchema(noOfferRequestRowSchema),
  });

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <h1>Teklifsiz talepler</h1>
      <p className="muted">
        Yayınlandıktan sonra seçilen süreden uzun zamandır hiç teklif almamış açık talepler. Dalga:
        talebin kaçıncı dağıtım turunda olduğu; gönderilen: talebin iletildiği usta sayısı.
      </p>
      <form method="get" className="card filters" aria-label="Filtreler">
        <label>
          En az şu kadar süredir teklifsiz
          <select name="olderThanMinutes" defaultValue={String(olderThanMinutes)}>
            {NO_OFFER_AGE_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {formatMinutes(m)}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button type="submit" className="btn btn-primary">
            Uygula
          </button>
        </div>
      </form>

      {!result.ok ? (
        <ApiErrorNotice error={result} what="Teklifsiz talepler" />
      ) : result.data.items.length === 0 ? (
        <p className="card">Bu süreden uzun zamandır teklifsiz bekleyen açık talep yok.</p>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Talep</th>
                <th>Kategori</th>
                <th>Konum</th>
                <th>Yayınlandı</th>
                <th className="num">Bekleme</th>
                <th className="num">Dalga</th>
                <th className="num">Gönderilen usta</th>
              </tr>
            </thead>
            <tbody>
              {result.data.items.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/service-requests/${r.id}`}>{r.title}</Link>
                  </td>
                  <td>{r.category.name}</td>
                  <td>
                    {r.district.name} / {r.province.name}
                  </td>
                  <td>{formatDate(r.publishedAt)}</td>
                  <td className="num">{formatMinutes(r.ageMinutes)}</td>
                  <td className="num">{formatCount(r.wave)}</td>
                  <td className="num">
                    {r.dispatchedCount === 0 ? (
                      <span className="pill pill-danger" title="Hiçbir ustaya gönderilemedi">
                        0
                      </span>
                    ) : (
                      formatCount(r.dispatchedCount)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.ok && result.data.nextCursor ? (
        <Link
          href={`/marketplace/no-offer?${new URLSearchParams({
            olderThanMinutes: String(olderThanMinutes),
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
