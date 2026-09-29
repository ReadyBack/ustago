import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { HealthBadge } from './health-badge';

afterEach(cleanup);

describe('HealthBadge', () => {
  it('shows the unreachable state when there is no health data', () => {
    render(<HealthBadge health={null} />);
    expect(screen.getByRole('status').dataset.state).toBe('unreachable');
    expect(screen.getByText('API erişilemiyor')).toBeDefined();
  });

  it('shows dependency states when the API responds', () => {
    render(
      <HealthBadge
        health={{
          status: 'ok',
          version: '0.0.0',
          uptimeSeconds: 1,
          timestamp: new Date().toISOString(),
          checks: { database: { status: 'up' }, redis: { status: 'up' } },
        }}
      />,
    );
    expect(screen.getByText('API çalışıyor')).toBeDefined();
    expect(screen.getByText(/DB up/)).toBeDefined();
  });
});
