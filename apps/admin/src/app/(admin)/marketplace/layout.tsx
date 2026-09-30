import { spacing } from '@ustago/ui';

import { MarketplaceNav } from './marketplace-nav';

/** The "Pazar yeri" group with its own sub navigation. Each page calls requireAdmin itself. */
export default function MarketplaceLayout({ children }: LayoutProps<'/marketplace'>) {
  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <MarketplaceNav />
      {children}
    </div>
  );
}
