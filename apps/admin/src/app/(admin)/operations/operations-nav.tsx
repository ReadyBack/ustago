'use client';

import { spacing } from '@ustago/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/operations', label: 'Durum ve anahtarlar' },
  { href: '/operations/alerts', label: 'Uyarılar' },
  { href: '/operations/reconciliation', label: 'Mutabakat çalıştırmaları' },
] as const;

export function OperationsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Operasyon" style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap' }}>
      {LINKS.map((link) => {
        const active =
          link.href === '/operations'
            ? pathname === '/operations'
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
