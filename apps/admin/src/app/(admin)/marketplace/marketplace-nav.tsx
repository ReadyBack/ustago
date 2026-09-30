'use client';

import { spacing } from '@ustago/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/marketplace', label: 'Genel bakış' },
  { href: '/marketplace/regions', label: 'Bölgeler' },
  { href: '/marketplace/provinces', label: 'İl açılışları' },
  { href: '/marketplace/categories', label: 'Kategoriler (analitik)' },
  { href: '/marketplace/no-offer', label: 'Teklifsiz talepler' },
] as const;

export function MarketplaceNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Pazar yeri" style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap' }}>
      {LINKS.map((link) => {
        const active =
          link.href === '/marketplace'
            ? pathname === '/marketplace'
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
