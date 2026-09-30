import Link from 'next/link';

import { PERIOD_OPTIONS, type PeriodDays } from '@/lib/marketplace';

/** "Son 7 / 30 / 90 gün" chips; keeps the other query params. */
export function PeriodPicker({
  basePath,
  current,
  params = {},
}: {
  basePath: string;
  current: PeriodDays;
  params?: Record<string, string | undefined>;
}) {
  return (
    <nav aria-label="Dönem" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {PERIOD_OPTIONS.map((days) => {
        const query = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) if (v) query.set(k, v);
        query.set('days', String(days));
        const active = days === current;
        return (
          <Link
            key={days}
            href={`${basePath}?${query.toString()}`}
            className={`chip${active ? ' chip-active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            Son {days} gün
          </Link>
        );
      })}
    </nav>
  );
}
