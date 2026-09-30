import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchMock, jsonResponse, mockCookies } from '../../test/setup-mocks';

vi.mock('server-only', () => ({}));
const cookies = mockCookies({ ustago_admin_at: 'admin-at', ustago_admin_rt: 'admin-rt' });
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve(cookies.store) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.stubGlobal('fetch', fetchMock);

const { createPenalty, moderateReview, resolveDispute, revokePenalty } =
  await import('./moderation-actions');

const ID = '0190a000-0000-7000-8000-00000000000a';
const PROVIDER = '0190a000-0000-7000-8000-00000000000b';

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1) ?? [];
  return {
    url: String(url),
    method: init?.method,
    body: JSON.parse(String(init?.body)) as unknown,
  };
}

const apiError = (status: number, code: string) =>
  jsonResponse(status, {
    statusCode: status,
    code,
    message: 'x',
    path: '/',
    timestamp: new Date().toISOString(),
  });

describe('moderation actions', () => {
  beforeEach(() => fetchMock.mockReset());

  it('refuses tampered ids and decisions without calling the API', async () => {
    expect(
      await resolveDispute({}, form({ id: '../x', outcome: 'CLOSED', note: 'Tamam' })),
    ).toEqual({
      error: 'Geçersiz istek.',
    });
    expect(await moderateReview({}, form({ id: ID, decision: 'delete', reason: 'Spam' }))).toEqual({
      error: 'Geçersiz istek.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates with the shared schemas before sending', async () => {
    const state = await resolveDispute({}, form({ id: ID, outcome: 'REFUND', note: 'Tamam' }));
    expect(state.error).toBeTruthy();
    const penalty = await createPenalty(
      {},
      form({
        providerId: PROVIDER,
        type: 'PERMANENT_BAN',
        reasonCode: 'NO_SHOW',
        reason: 'Üç kez gelmedi.',
      }),
    );
    expect(penalty.error).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves a dispute with the outcome and note', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    const state = await resolveDispute(
      {},
      form({ id: ID, outcome: 'RESOLVED_FOR_CUSTOMER', note: 'Usta adrese gelmedi.' }),
    );
    expect(state).toEqual({ ok: true });
    expect(lastCall()).toMatchObject({
      method: 'POST',
      body: { outcome: 'RESOLVED_FOR_CUSTOMER', note: 'Usta adrese gelmedi.' },
    });
    expect(lastCall().url).toMatch(new RegExp(`/api/v1/admin/disputes/${ID}/resolve$`));
  });

  it('hides and restores reviews through their own endpoints', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, {})));
    await moderateReview({}, form({ id: ID, decision: 'hide', reason: 'Kişisel bilgi içeriyor' }));
    expect(lastCall().url).toMatch(new RegExp(`/admin/reviews/${ID}/hide$`));
    await moderateReview({}, form({ id: ID, decision: 'restore', reason: 'Düzeltildi' }));
    expect(lastCall().url).toMatch(new RegExp(`/admin/reviews/${ID}/restore$`));
  });

  it('creates a penalty ending after the chosen Istanbul day', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, {}));
    const state = await createPenalty(
      {},
      form({
        providerId: PROVIDER,
        type: 'NOW_SUSPENSION',
        reasonCode: 'no_show',
        reason: 'İki acil işe gelmedi.',
        endsOn: '2026-10-15',
      }),
    );
    expect(state).toEqual({ ok: true });
    expect(lastCall().url).toMatch(new RegExp(`/admin/providers/${PROVIDER}/penalties$`));
    expect(lastCall().body).toEqual({
      type: 'NOW_SUSPENSION',
      reasonCode: 'NO_SHOW',
      reason: 'İki acil işe gelmedi.',
      endsAt: '2026-10-15T21:00:00.000Z',
    });
  });

  it('translates known API errors', async () => {
    fetchMock.mockResolvedValueOnce(apiError(409, 'DISPUTE_ALREADY_RESOLVED'));
    const state = await resolveDispute({}, form({ id: ID, outcome: 'CLOSED', note: 'Kapatıldı' }));
    expect(state.error).toMatch(/zaten sonuçlandırıldı/);
    fetchMock.mockResolvedValueOnce(apiError(409, 'PENALTY_NOT_ACTIVE'));
    const revoke = await revokePenalty({}, form({ id: ID, providerId: PROVIDER, reason: 'Hata' }));
    expect(revoke.error).toMatch(/yürürlükte değil/);
  });
});
