import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PaymentStatusPill, PayoutStatusPill } from './finance-pills';
import { TestModeBanner } from './test-mode-banner';

afterEach(cleanup);

describe('TestModeBanner', () => {
  it('warns loudly while the mock payment provider is active', () => {
    render(<TestModeBanner testMode />);
    const banner = screen.getByRole('note', { name: 'Test ödeme sağlayıcısı' });
    expect(banner.textContent).toContain('TEST ÖDEME SAĞLAYICISI AKTİF');
    expect(screen.getByText('Gerçek para hareketi yoktur.')).toBeDefined();
  });

  it('renders nothing with a real provider', () => {
    const { container } = render(<TestModeBanner testMode={false} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('finance pills', () => {
  it('labels payment and payout statuses in Turkish with a tone', () => {
    render(<PaymentStatusPill status="PARTIALLY_REFUNDED" />);
    expect(screen.getByText('Kısmi iade').className).toContain('pill-warning');
    render(<PayoutStatusPill status="FAILED" />);
    expect(screen.getByText('Başarısız').className).toContain('pill-danger');
  });
});
