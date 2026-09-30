import { adminFinanceSummarySchema } from '@ustago/validation';
import { spacing } from '@ustago/ui';

import { TestModeBanner } from '@/components/test-mode-banner';
import { apiRequest } from '@/lib/api';

import { FinanceNav } from './finance-nav';

/**
 * The "Finans" group: its own sub navigation and, whenever the API runs
 * with the mock payment provider, the test banner on every page. Each page
 * still calls requireAdmin itself.
 */
export default async function FinanceLayout({ children }: LayoutProps<'/finance'>) {
  const summary = await apiRequest('/admin/finance/summary?range=today', {
    schema: adminFinanceSummarySchema,
  });
  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <FinanceNav />
      <TestModeBanner testMode={summary.ok && summary.data.testMode} />
      {children}
    </div>
  );
}
