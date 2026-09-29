import { describe, expect, it, vi } from 'vitest';

import { mockCookies } from '../test/setup-mocks';

vi.mock('server-only', () => ({}));
const cookies = mockCookies();
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve(cookies.store) }));

const { ACCESS_COOKIE, clearSessionCookies, REFRESH_COOKIE, setSessionCookies } =
  await import('./session');

describe('admin session cookies', () => {
  it('stores both tokens in httpOnly, SameSite=Strict cookies that expire with the tokens', async () => {
    const now = Date.now();
    await setSessionCookies({
      tokenType: 'Bearer',
      accessToken: 'access-token',
      accessTokenExpiresAt: new Date(now + 900_000).toISOString(),
      refreshToken: 'refresh-token',
      refreshTokenExpiresAt: new Date(now + 30 * 86_400_000).toISOString(),
    });
    const access = cookies.sets.find((c) => c.name === ACCESS_COOKIE);
    const refresh = cookies.sets.find((c) => c.name === REFRESH_COOKIE);
    for (const cookie of [access, refresh]) {
      expect(cookie?.options).toMatchObject({ httpOnly: true, sameSite: 'strict', path: '/' });
    }
    expect(access?.options['maxAge']).toBeGreaterThan(890);
    expect(access?.options['maxAge']).toBeLessThanOrEqual(900);
    expect(refresh?.options['maxAge']).toBeGreaterThan(29 * 86_400);

    await clearSessionCookies();
    expect(cookies.deletes).toEqual([ACCESS_COOKIE, REFRESH_COOKIE]);
  });
});
