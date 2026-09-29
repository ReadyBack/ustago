import { describe, expect, it } from 'vitest';

import { colors, typography } from './tokens.js';

describe('design tokens', () => {
  it('uses 6-digit hex colors', () => {
    for (const value of Object.values(colors)) {
      expect(value).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('keeps touch targets at least 48', () => {
    expect(typography.minTouchTarget).toBeGreaterThanOrEqual(48);
  });
});
