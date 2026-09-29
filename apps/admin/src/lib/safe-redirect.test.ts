import { describe, expect, it } from 'vitest';

import { safeNextPath } from './safe-redirect';

describe('safeNextPath', () => {
  it.each(['/', '/providers', '/providers/abc?status=ACTIVE'])('keeps %s', (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'providers',
    '/ok\r\nSet-Cookie: x=y',
    undefined,
    null,
    42,
  ])('falls back for %s', (value) => {
    expect(safeNextPath(value)).toBe('/');
  });
});
