import { spacing } from '@ustago/ui';

import { OperationsNav } from './operations-nav';

/** The "Operasyon" group with its own sub navigation. Each page calls requireAdmin itself. */
export default function OperationsLayout({ children }: LayoutProps<'/operations'>) {
  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <OperationsNav />
      {children}
    </div>
  );
}
