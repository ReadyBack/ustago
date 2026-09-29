import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchMock, jsonResponse, mockCookies, RedirectError } from '../../test/setup-mocks';

vi.mock('server-only', () => ({}));
const cookies = mockCookies();
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve(cookies.store) }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
}));
vi.stubGlobal('fetch', fetchMock);

const { login } = await import('./actions');

const tokens = {
  tokenType: 'Bearer',
  accessToken: 'at',
  accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
  refreshToken: 'rt',
  refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};

function user(roles: string[]) {
  return {
    id: '0190a000-0000-7000-8000-000000000001',
    email: 'admin@ustago.test',
    phone: null,
    firstName: 'Dev',
    lastName: 'Admin',
    status: 'ACTIVE',
    locale: 'tr-TR',
    roles,
    emailVerifiedAt: null,
    phoneVerifiedAt: null,
    createdAt: new Date().toISOString(),
    customerProfile: null,
    providerProfile: null,
  };
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

describe('admin login action', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    cookies.sets.length = 0;
  });

  it('signs an admin in, sets cookies and follows a safe next path', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { user: user(['CUSTOMER', 'ADMIN']), tokens }),
    );
    await expect(
      login(
        {},
        form({ email: 'admin@ustago.test', password: 'dogru-sifre-123', next: '/providers' }),
      ),
    ).rejects.toMatchObject({ url: '/providers' });
    expect(cookies.sets.map((c) => c.name)).toEqual(['ustago_admin_at', 'ustago_admin_rt']);
  });

  it('never redirects off-site after login', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: user(['SUPER_ADMIN']), tokens }));
    await expect(
      login(
        {},
        form({ email: 'a@ustago.test', password: 'dogru-sifre-123', next: '//evil.example' }),
      ),
    ).rejects.toMatchObject({ url: '/' });
  });

  it('refuses non-admin accounts and ends the session it just created', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { user: user(['CUSTOMER', 'PROVIDER']), tokens }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const state = await login({}, form({ email: 'u@ustago.test', password: 'dogru-sifre-123' }));
    expect(state.error).toMatch(/yetkisi yok/);
    expect(cookies.sets).toHaveLength(0);
    const [url, init] = fetchMock.mock.calls[1] ?? [];
    expect(String(url)).toMatch(/\/api\/v1\/auth\/logout$/);
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer at');
  });

  it('shows a generic message for wrong credentials', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, {
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'E-posta veya şifre hatalı.',
        path: '/api/v1/auth/login',
        timestamp: new Date().toISOString(),
      }),
    );
    const state = await login({}, form({ email: 'a@ustago.test', password: 'yanlis-sifre-1' }));
    expect(state).toEqual({ error: 'E-posta veya şifre hatalı.', email: 'a@ustago.test' });
  });

  it('validates input before calling the API', async () => {
    const state = await login({}, form({ email: 'not-an-email', password: '' }));
    expect(state.error).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
