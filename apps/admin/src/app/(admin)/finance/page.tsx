import { adminFinanceSummarySchema, formatMoney } from '@ustago/validation';
import { colors, spacing } from '@ustago/ui';
import Link from 'next/link';

import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { FINANCE_RANGE_LABELS, parseFinanceRange } from '@/lib/finance';
import { formatDate } from '@/lib/labels';

type Summary = Extract<
  Awaited<ReturnType<typeof apiRequest<typeof adminFinanceSummarySchema>>>,
  { ok: true }
>['data'];

interface Card {
  label: string;
  value: (s: Summary) => string;
  detail?: (s: Summary) => string;
  href?: string;
  /** Highlighted when the value needs attention. */
  urgent?: (s: Summary) => boolean;
}

const CARDS: Card[] = [
  {
    label: 'Online ödeme hacmi',
    value: (s) => formatMoney(s.onlineVolume),
    detail: (s) => `${s.onlineCount} ödeme`,
    href: '/finance/payments?method=IN_APP',
  },
  {
    label: 'Nakit (ustaya doğrudan) hacim',
    value: (s) => formatMoney(s.cashVolume),
    detail: (s) => `${s.cashCount} iş`,
    href: '/finance/cash',
  },
  {
    label: 'Net platform hizmet bedeli',
    value: (s) => formatMoney(s.platformFees),
    detail: () => 'Bedeller − bedel iadeleri',
  },
  {
    label: 'Ustalara borç (bakiye)',
    value: (s) => formatMoney(s.providerPayable),
    detail: () => 'Bekleyen + kullanılabilir + ayrılmış',
  },
  {
    label: 'Ustaların platforma borcu',
    value: (s) => formatMoney(s.providerDebt),
  },
  {
    label: 'Bekleyen iadeler',
    value: (s) => formatMoney(s.pendingRefunds.amount),
    detail: (s) => `${s.pendingRefunds.count} iade`,
    urgent: (s) => s.pendingRefunds.count > 0,
  },
  {
    label: 'Bekleyen para çekme',
    value: (s) => formatMoney(s.pendingPayouts.amount),
    detail: (s) => `${s.pendingPayouts.count} talep`,
    href: '/finance/payouts?status=REQUESTED',
    urgent: (s) => s.pendingPayouts.count > 0,
  },
  {
    label: 'Açık nakit anlaşmazlığı',
    value: (s) => String(s.openCashDisputes),
    href: '/finance/cash?status=DISPUTED',
    urgent: (s) => s.openCashDisputes > 0,
  },
];

export default async function FinanceSummaryPage(props: PageProps<'/finance'>) {
  const range = parseFinanceRange(await props.searchParams);
  await requireAdmin(`/finance?range=${range}`);
  const result = await apiRequest(`/admin/finance/summary?range=${range}`, {
    schema: adminFinanceSummarySchema,
  });

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <h1>Finans özeti</h1>
      <nav aria-label="Dönem" style={{ display: 'flex', gap: spacing.sm }}>
        {(Object.keys(FINANCE_RANGE_LABELS) as (keyof typeof FINANCE_RANGE_LABELS)[]).map((r) => (
          <Link
            key={r}
            href={`/finance?range=${r}`}
            className={`btn${r === range ? ' btn-primary' : ''}`}
            aria-current={r === range ? 'page' : undefined}
          >
            {FINANCE_RANGE_LABELS[r]}
          </Link>
        ))}
      </nav>
      {!result.ok ? (
        <p role="alert">Özet alınamadı: {result.message}</p>
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gap: spacing.md,
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            }}
          >
            {CARDS.map((card) => {
              const urgent = card.urgent?.(result.data) ?? false;
              const body = (
                <>
                  <span
                    className="stat-value"
                    style={{ fontSize: 26, ...(urgent ? { color: colors.emergency } : {}) }}
                  >
                    {card.value(result.data)}
                  </span>
                  <span style={{ color: colors.textSecondary }}>{card.label}</span>
                  {card.detail ? (
                    <span style={{ color: colors.textSecondary, fontSize: 13 }}>
                      {card.detail(result.data)}
                    </span>
                  ) : null}
                </>
              );
              const style = urgent ? { borderColor: colors.emergency } : undefined;
              return card.href ? (
                <Link key={card.label} href={card.href} className="card stat" style={style}>
                  {body}
                </Link>
              ) : (
                <div key={card.label} className="card stat" style={style}>
                  {body}
                </div>
              );
            })}
          </div>
          <p style={{ color: colors.textSecondary, fontSize: 13 }}>
            Veritabanından canlı okunur. Hacim ve bedel {formatDate(result.data.from)} –{' '}
            {formatDate(result.data.to)} arasını kapsar; bakiye, borç ve bekleyen kalemler şu anki
            durumdur.
          </p>
        </>
      )}
    </div>
  );
}
