import { colors, spacing } from '@ustago/ui';

/**
 * Shown on every finance page while the API runs with the mock payment
 * provider, so nobody mistakes test money for real money.
 */
export function TestModeBanner({ testMode }: { testMode: boolean }) {
  if (!testMode) return null;
  return (
    <div
      role="note"
      aria-label="Test ödeme sağlayıcısı"
      data-testid="test-mode-banner"
      style={{
        display: 'grid',
        gap: spacing.xs,
        padding: spacing.md,
        borderRadius: 12,
        border: `2px solid ${colors.warning}`,
        background: '#FFF4DC',
        color: '#8A5A00',
      }}
    >
      <strong style={{ fontSize: 18, letterSpacing: 0.5 }}>TEST ÖDEME SAĞLAYICISI AKTİF</strong>
      <span>Gerçek para hareketi yoktur.</span>
    </div>
  );
}
