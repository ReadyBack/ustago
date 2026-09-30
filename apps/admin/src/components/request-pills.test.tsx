import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { QuoteStatusPill, RequestStatusPill, RequestTypePill } from './request-pills';

afterEach(cleanup);

describe('request pills', () => {
  it('labels statuses in Turkish with a tone', () => {
    render(<RequestStatusPill status="MATCHED" />);
    expect(screen.getByText('Anlaşıldı').className).toContain('pill-success');
  });

  it('marks NOW requests as urgent', () => {
    render(<RequestTypePill type="NOW" />);
    expect(screen.getByText(/ACİL \(NOW\)/).className).toContain('pill-danger');
  });

  it('shows whose turn a quote is', () => {
    render(<QuoteStatusPill status="PENDING_PROVIDER" />);
    expect(screen.getByText('Usta yanıtı bekleniyor')).toBeDefined();
  });
});
