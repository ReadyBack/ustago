import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchMock, jsonResponse, mockCookies } from '../../test/setup-mocks';

vi.mock('server-only', () => ({}));
const cookies = mockCookies({ ustago_admin_at: 'admin-at', ustago_admin_rt: 'admin-rt' });
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve(cookies.store) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.stubGlobal('fetch', fetchMock);

const {
  acknowledgeAlert,
  createFeePolicy,
  decideFeePolicy,
  resolveAlert,
  runOpsMonitor,
  runReconciliation,
  setRuntimeFlag,
} = await import('./ops-actions');

const ID = '0190a000-0000-7000-8000-00000000000a';

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
    body: init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown),
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

const ok = () => Promise.resolve(jsonResponse(200, {}));

describe('fee policies', () => {
  beforeEach(() => fetchMock.mockReset());

  const create = (overrides: Record<string, string> = {}) =>
    form({
      code: 'standart-2026-11',
      name: 'Standart Kasım 2026',
      rate: '12,5',
      effectiveFrom: '2026-11-01T00:00',
      ...overrides,
    });

  it('creates a draft with basis points and an Istanbul start time', async () => {
    fetchMock.mockImplementation(ok);
    expect(await createFeePolicy({}, create())).toEqual({ ok: true });
    expect(lastCall().url).toMatch(/\/api\/v1\/admin\/fee-policies$/);
    expect(lastCall().body).toMatchObject({
      code: 'standart-2026-11',
      name: 'Standart Kasım 2026',
      bps: 1250,
      effectiveFrom: '2026-10-31T21:00:00.000Z',
    });
  });

  it('validates the rate, start and code before calling the API', async () => {
    expect((await createFeePolicy({}, create({ rate: '60' }))).error).toMatch(/en fazla %50/);
    expect((await createFeePolicy({}, create({ effectiveFrom: '' }))).error).toMatch(
      /başlangıç zamanı/,
    );
    expect((await createFeePolicy({}, create({ code: 'Büyük Harf' }))).error).toMatch(/Kod/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('publishes and retires only with the confirm box, deletes drafts', async () => {
    expect(await decideFeePolicy({}, form({ id: ID, decision: 'publish' }))).toEqual({
      error: 'İşlemi onaylamak için kutuyu işaretleyin.',
    });
    expect(await decideFeePolicy({}, form({ id: ID, decision: 'edit', confirm: 'yes' }))).toEqual({
      error: 'Geçersiz istek.',
    });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockImplementation(ok);
    await decideFeePolicy({}, form({ id: ID, decision: 'publish', confirm: 'yes' }));
    expect(lastCall().url).toMatch(new RegExp(`/admin/fee-policies/${ID}/publish$`));
    expect(lastCall().body).toEqual({ confirm: true });
    await decideFeePolicy({}, form({ id: ID, decision: 'retire', confirm: 'yes' }));
    expect(lastCall().url).toMatch(new RegExp(`/admin/fee-policies/${ID}/retire$`));
    await decideFeePolicy({}, form({ id: ID, decision: 'delete' }));
    expect(lastCall()).toMatchObject({ method: 'DELETE', body: undefined });
  });

  it('explains lifecycle refusals', async () => {
    fetchMock.mockResolvedValueOnce(apiError(422, 'FEE_POLICY_START_IN_PAST'));
    expect(
      (await decideFeePolicy({}, form({ id: ID, decision: 'publish', confirm: 'yes' }))).error,
    ).toMatch(/Geriye dönük/);
    fetchMock.mockResolvedValueOnce(apiError(403, 'ADMIN_PERMISSION_REQUIRED'));
    expect((await createFeePolicy({}, create())).error).toBe('Bu işlem için yetkiniz yok.');
  });
});

describe('alerts', () => {
  beforeEach(() => fetchMock.mockReset());

  it('acknowledges and resolves with a note', async () => {
    fetchMock.mockImplementation(ok);
    await acknowledgeAlert({}, form({ id: ID }));
    expect(lastCall().url).toMatch(new RegExp(`/admin/alerts/${ID}/acknowledge$`));
    expect(lastCall().body).toBeUndefined();
    expect((await resolveAlert({}, form({ id: ID, note: 'ok' }))).error).toMatch(/5–1000/);
    await resolveAlert({}, form({ id: ID, note: 'Sağlayıcı ile kontrol edildi.' }));
    expect(lastCall().url).toMatch(new RegExp(`/admin/alerts/${ID}/resolve$`));
    expect(lastCall().body).toEqual({ note: 'Sağlayıcı ile kontrol edildi.' });
  });
});

describe('monitor and reconciliation', () => {
  beforeEach(() => fetchMock.mockReset());

  it('runs the monitor and reconciliation', async () => {
    fetchMock.mockImplementation(ok);
    expect(await runOpsMonitor({})).toEqual({ ok: true });
    expect(lastCall().url).toMatch(/\/admin\/ops\/monitor\/run$/);
    expect(await runReconciliation({})).toEqual({ ok: true });
    expect(lastCall()).toMatchObject({ method: 'POST' });
    expect(lastCall().url).toMatch(/\/admin\/finance\/reconciliation\/runs$/);
  });

  it('reports a concurrent run', async () => {
    fetchMock.mockResolvedValueOnce(apiError(409, 'RECONCILIATION_RUNNING'));
    expect((await runReconciliation({})).error).toMatch(/zaten çalışıyor/);
  });
});

describe('setRuntimeFlag', () => {
  beforeEach(() => fetchMock.mockReset());

  const flag = (overrides: Record<string, string> = {}) =>
    form({ key: 'payouts', enabled: 'false', reason: 'Sağlayıcıda arıza var.', ...overrides });

  it('refuses bad keys, missing confirmation and short reasons', async () => {
    expect(await setRuntimeFlag({}, flag({ key: '../x', confirm: 'yes' }))).toEqual({
      error: 'Geçersiz istek.',
    });
    expect(await setRuntimeFlag({}, flag())).toEqual({
      error: 'İşlemi onaylamak için kutuyu işaretleyin.',
    });
    expect((await setRuntimeFlag({}, flag({ reason: 'x', confirm: 'yes' }))).error).toMatch(
      /Gerekçe/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('puts the new value with reason and confirm: true', async () => {
    fetchMock.mockImplementation(ok);
    await setRuntimeFlag({}, flag({ confirm: 'yes' }));
    expect(lastCall()).toMatchObject({
      method: 'PUT',
      body: { enabled: false, reason: 'Sağlayıcıda arıza var.', confirm: true },
    });
    expect(lastCall().url).toMatch(/\/admin\/runtime-flags\/payouts$/);
  });
});
