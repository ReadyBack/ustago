'use client';

import { spacing } from '@ustago/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/finance', label: 'Finans özeti' },
  { href: '/finance/payments', label: 'Ödemeler' },
  { href: '/finance/ledger', label: 'Defter' },
  { href: '/finance/payouts', label: 'Para çekme talepleri' },
  { href: '/finance/cash', label: 'Nakit ödemeler' },
  { href: '/finance/reconciliation', label: 'Mutabakat' },
] as const;

export function FinanceNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Finans" style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap' }}>
      {LINKS.map((link) => {
        const active =
          link.href === '/finance'
            ? pathname === '/finance'
            : pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`chip${active ? ' chip-active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
