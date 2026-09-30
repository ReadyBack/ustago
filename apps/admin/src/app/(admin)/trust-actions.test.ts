import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchMock, jsonResponse, mockCookies } from '../../test/setup-mocks';

vi.mock('server-only', () => ({}));
const cookies = mockCookies({ ustago_admin_at: 'admin-at', ustago_admin_rt: 'admin-rt' });
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve(cookies.store) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.stubGlobal('fetch', fetchMock);

const {
  addCategoryRequirement,
  decideVerificationCase,
  liftSuspension,
  removeCategoryRequirement,
  reviewRiskSignal,
  setAdminPermissions,
  suspendProvider,
} = await import('./trust-actions');

const ID = '0190a000-0000-7000-8000-00000000000a';
const DOC = '0190a000-0000-7000-8000-00000000000d';

function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const item of Array.isArray(v) ? v : [v]) data.append(k, item);
  }
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

const decision = (overrides: Record<string, string | string[]> = {}) =>
  form({
    providerId: ID,
    expectedVersion: '3',
    decision: 'request-revision',
    reasonCode: 'DOCUMENT_UNREADABLE',
    userVisibleReason: 'Kimlik fotoğrafı bulanık, lütfen yeniden yükleyin.',
    internalNote: '',
    ...overrides,
  });

describe('decideVerificationCase', () => {
  beforeEach(() => fetchMock.mockReset());

  it('refuses tampered ids, decisions and versions without calling the API', async () => {
    const cases: Record<string, string>[] = [
      { providerId: '../x' },
      { decision: 'delete' },
      { expectedVersion: '' },
      { expectedVersion: '-1' },
    ];
    for (const bad of cases) {
      expect(await decideVerificationCase({}, decision(bad))).toEqual({
        error: 'Geçersiz istek.',
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the expected version with every decision', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, {})));
    await decideVerificationCase({}, decision({ decision: 'start-review' }));
    expect(lastCall().url).toMatch(new RegExp(`/admin/verification-cases/${ID}/start-review$`));
    expect(lastCall().body).toEqual({ expectedVersion: 3 });

    await decideVerificationCase({}, decision({ decision: 'approve', internalNote: 'Tamam.' }));
    expect(lastCall().url).toMatch(/\/approve$/);
    expect(lastCall().body).toEqual({ expectedVersion: 3, internalNote: 'Tamam.' });

    await decideVerificationCase({}, decision({ rejectDocumentIds: [DOC] }));
    expect(lastCall().url).toMatch(/\/request-revision$/);
    expect(lastCall().body).toEqual({
      expectedVersion: 3,
      reasonCode: 'DOCUMENT_UNREADABLE',
      userVisibleReason: 'Kimlik fotoğrafı bulanık, lütfen yeniden yükleyin.',
      rejectDocumentIds: [DOC],
    });

    await decideVerificationCase({}, decision({ decision: 'reject', reasonCode: 'NOT_ELIGIBLE' }));
    expect(lastCall().url).toMatch(/\/reject$/);
    expect(lastCall().body).toMatchObject({ reasonCode: 'NOT_ELIGIBLE', expectedVersion: 3 });
  });

  it('needs a reason code and a user-visible reason for revision and rejection', async () => {
    expect((await decideVerificationCase({}, decision({ reasonCode: '' }))).error).toMatch(
      /gerekçe kodu/,
    );
    expect(
      (await decideVerificationCase({}, decision({ userVisibleReason: 'kısa' }))).error,
    ).toMatch(/Ustaya gösterilecek/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explains a version conflict and a missing permission in Turkish', async () => {
    fetchMock.mockResolvedValueOnce(apiError(409, 'VERIFICATION_VERSION_CONFLICT'));
    expect(await decideVerificationCase({}, decision())).toEqual({
      error: 'Kayıt başka biri tarafından güncellendi, sayfayı yenileyin.',
    });
    fetchMock.mockResolvedValueOnce(apiError(403, 'ADMIN_PERMISSION_REQUIRED'));
    expect(await decideVerificationCase({}, decision())).toEqual({
      error: 'Bu işlem için yetkiniz yok.',
    });
  });
});

describe('suspensions', () => {
  beforeEach(() => fetchMock.mockReset());

  const suspend = (overrides: Record<string, string> = {}) =>
    form({
      providerId: ID,
      level: 'SUSPENDED',
      reasonCode: 'POLICY_VIOLATION',
      userVisibleReason: 'Platform kurallarını ihlal ettiniz.',
      internalNote: '',
      expiresOn: '',
      ...overrides,
    });

  it('suspends until lifted, or until the end of the chosen Istanbul day', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(201, {})));
    expect(await suspendProvider({}, suspend())).toEqual({ ok: true });
    expect(lastCall().url).toMatch(new RegExp(`/admin/providers/${ID}/suspensions$`));
    expect(lastCall().body).toEqual({
      level: 'SUSPENDED',
      reasonCode: 'POLICY_VIOLATION',
      userVisibleReason: 'Platform kurallarını ihlal ettiniz.',
      autoLift: false,
    });
    await suspendProvider({}, suspend({ expiresOn: '2026-10-15', autoLift: 'yes' }));
    expect(lastCall().body).toMatchObject({
      expiresAt: '2026-10-15T21:00:00.000Z',
      autoLift: true,
    });
  });

  it('refuses a temporary permanent ban and bad dates', async () => {
    expect(
      (await suspendProvider({}, suspend({ level: 'BANNED', expiresOn: '2026-10-15' }))).error,
    ).toMatch(/Kalıcı kapatma süreli olamaz/);
    expect((await suspendProvider({}, suspend({ expiresOn: '15.10.2026' }))).error).toMatch(
      /bitiş tarihi/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lifts with a note', async () => {
    expect((await liftSuspension({}, form({ providerId: ID, note: 'ok' }))).error).toBeTruthy();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await liftSuspension({}, form({ providerId: ID, note: 'İtiraz kabul edildi.' }));
    expect(lastCall().url).toMatch(new RegExp(`/admin/providers/${ID}/suspensions/lift$`));
    expect(lastCall().body).toEqual({ note: 'İtiraz kabul edildi.' });
  });
});

describe('category requirements', () => {
  beforeEach(() => fetchMock.mockReset());

  it('adds and removes a document rule', async () => {
    expect(
      (await addCategoryRequirement({}, form({ categoryId: '', documentType: 'IDENTITY' }))).error,
    ).toMatch(/kategori/);
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    await addCategoryRequirement(
      {},
      form({ categoryId: ID, documentType: 'PROFESSIONAL_CERTIFICATE', note: '' }),
    );
    expect(lastCall().url).toMatch(new RegExp(`/admin/categories/${ID}/requirements$`));
    expect(lastCall().body).toEqual({ documentType: 'PROFESSIONAL_CERTIFICATE' });
    expect(await removeCategoryRequirement({}, form({ id: ID }))).toEqual({ ok: true });
    expect(lastCall()).toMatchObject({ method: 'DELETE', body: undefined });
    expect(lastCall().url).toMatch(new RegExp(`/admin/category-requirements/${ID}$`));
  });
});

describe('setAdminPermissions', () => {
  beforeEach(() => fetchMock.mockReset());

  it('requires the confirm box', async () => {
    expect(
      await setAdminPermissions({}, form({ userId: ID, permissions: ['ADMIN_FINANCE'] })),
    ).toEqual({ error: 'Değişikliği onaylamak için kutuyu işaretleyin.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('replaces the grants with confirm: true', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, {})));
    await setAdminPermissions(
      {},
      form({ userId: ID, permissions: ['ADMIN_FINANCE', 'ADMIN_SUPPORT'], confirm: 'yes' }),
    );
    expect(lastCall()).toMatchObject({
      method: 'PUT',
      body: { permissions: ['ADMIN_FINANCE', 'ADMIN_SUPPORT'], confirm: true },
    });
    expect(lastCall().url).toMatch(new RegExp(`/admin/users/${ID}/permissions$`));
    await setAdminPermissions({}, form({ userId: ID, confirm: 'yes' }));
    expect(lastCall().body).toEqual({ permissions: [], confirm: true });
    expect(
      (await setAdminPermissions({}, form({ userId: ID, permissions: ['ROOT'], confirm: 'yes' })))
        .error,
    ).toBe('Geçersiz yetki seçimi.');
  });

  it('shows the self-change refusal', async () => {
    fetchMock.mockResolvedValueOnce(apiError(403, 'ADMIN_SELF_PERMISSION_CHANGE'));
    expect((await setAdminPermissions({}, form({ userId: ID, confirm: 'yes' }))).error).toMatch(
      /Kendi yetkilerinizi/,
    );
  });
});

describe('reviewRiskSignal', () => {
  beforeEach(() => fetchMock.mockReset());

  it('records a review decision', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(
      await reviewRiskSignal({}, form({ id: ID, status: 'DISMISSED', note: 'Yanlış alarm.' })),
    ).toEqual({ ok: true });
    expect(lastCall().body).toEqual({ status: 'DISMISSED', note: 'Yanlış alarm.' });
    const bad = await reviewRiskSignal({}, form({ id: ID, status: 'BANNED', note: 'x x' }));
    expect(bad.error).toBe('Bir karar seçin.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
