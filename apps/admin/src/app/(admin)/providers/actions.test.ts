import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchMock, jsonResponse, mockCookies } from '../../../test/setup-mocks';

vi.mock('server-only', () => ({}));
const cookies = mockCookies({ ustago_admin_at: 'admin-at', ustago_admin_rt: 'admin-rt' });
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve(cookies.store) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.stubGlobal('fetch', fetchMock);

const { review } = await import('./actions');

const ID = '0190a000-0000-7000-8000-00000000000a';

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

describe('review action', () => {
  beforeEach(() => fetchMock.mockReset());

  it.each([
    { target: 'user', decision: 'approve', id: ID },
    { target: 'provider', decision: 'delete', id: ID },
    { target: 'verification', decision: 'suspend', id: ID },
    { target: 'provider', decision: 'approve', id: '../../users' },
  ])('refuses %o without calling the API', async (fields) => {
    const state = await review({}, form(fields));
    expect(state.error).toBe('Geçersiz istek.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a reason to reject', async () => {
    const state = await review(
      {},
      form({ target: 'provider', decision: 'reject', id: ID, reason: 'x' }),
    );
    expect(state.error).toMatch(/Sebep/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls the matching admin endpoint with the session token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    const state = await review(
      {},
      form({ target: 'verification', decision: 'reject', id: ID, reason: 'Fotoğraf bulanık.' }),
    );
    expect(state).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toMatch(new RegExp(`/api/v1/admin/provider-verifications/${ID}/reject$`));
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ reason: 'Fotoğraf bulanık.' });
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer admin-at');
  });

  it('translates known API errors', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, {
        statusCode: 409,
        code: 'VERIFICATION_ALREADY_REVIEWED',
        message: 'x',
        path: '/',
        timestamp: new Date().toISOString(),
      }),
    );
    const state = await review({}, form({ target: 'verification', decision: 'approve', id: ID }));
    expect(state.error).toMatch(/zaten incelendi/);
  });
});
