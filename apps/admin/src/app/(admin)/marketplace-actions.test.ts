import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchMock, jsonResponse, mockCookies } from '../../test/setup-mocks';

vi.mock('server-only', () => ({}));
const cookies = mockCookies({ ustago_admin_at: 'admin-at', ustago_admin_rt: 'admin-rt' });
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve(cookies.store) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.stubGlobal('fetch', fetchMock);

const {
  accessReportedConversation,
  addCategoryAlias,
  createCategoryQuestion,
  resolveMessageReport,
  setCategoryPhotoPolicy,
  setCategoryQuestionActive,
  setProvinceLaunchStatus,
  updateCategoryQuestion,
} = await import('./marketplace-actions');

const CAT = '0190a000-0000-7000-8000-00000000000a';
const Q = '0190a000-0000-7000-8000-00000000000b';
const REPORT = '0190a000-0000-7000-8000-00000000000c';
const MSG = '0190a000-0000-7000-8000-00000000000d';
const CONV = '0190a000-0000-7000-8000-00000000000e';

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1) ?? [];
  return {
    url: String(url),
    method: init?.method,
    cache: init?.cache,
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

beforeEach(() => fetchMock.mockReset());

describe('setProvinceLaunchStatus', () => {
  it('needs the confirmation and a valid province and status', async () => {
    expect(
      await setProvinceLaunchStatus({}, form({ provinceId: '34', launchStatus: 'WAITLIST' })),
    ).toEqual({ error: 'Değişikliği onaylayın.' });
    expect(
      await setProvinceLaunchStatus(
        {},
        form({ provinceId: '99', launchStatus: 'ACTIVE', confirm: 'yes' }),
      ),
    ).toEqual({ error: 'Geçersiz istek.' });
    expect(
      await setProvinceLaunchStatus(
        {},
        form({ provinceId: '34', launchStatus: 'OPEN', confirm: 'yes' }),
      ),
    ).toEqual({ error: 'Geçersiz istek.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('patches the province with the mapped flags', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, {})));
    await setProvinceLaunchStatus(
      {},
      form({ provinceId: '34', launchStatus: 'WAITLIST', confirm: 'yes' }),
    );
    expect(lastCall()).toMatchObject({
      method: 'PATCH',
      body: { isActive: false, waitlistOpen: true },
    });
    expect(lastCall().url).toMatch(/\/api\/v1\/locations\/provinces\/34$/);
  });

  it('shows a missing permission in Turkish', async () => {
    fetchMock.mockResolvedValueOnce(apiError(403, 'FORBIDDEN'));
    expect(
      await setProvinceLaunchStatus(
        {},
        form({ provinceId: '6', launchStatus: 'DISABLED', confirm: 'yes' }),
      ),
    ).toEqual({ error: 'Bu işlem için yetkiniz yok.' });
  });
});

describe('category content', () => {
  const draft = {
    key: 'ariza_turu',
    type: 'SINGLE_SELECT',
    label: 'Arıza türü nedir?',
    helpText: '',
    required: true,
    minValue: '',
    maxValue: '',
    sortOrder: '0',
    isActive: true,
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ],
  };

  it('validates the question again on the server before posting', async () => {
    expect(
      await createCategoryQuestion(
        {},
        form({ categoryId: CAT, draft: JSON.stringify({ ...draft, options: [] }) }),
      ),
    ).toEqual({ error: 'Seçmeli sorular en az iki farklı seçenek ister.' });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(201, {})));
    expect(
      await createCategoryQuestion({}, form({ categoryId: CAT, draft: JSON.stringify(draft) })),
    ).toEqual({ ok: true });
    expect(lastCall().url).toMatch(new RegExp(`/admin/categories/${CAT}/questions$`));
    expect(lastCall().body).toMatchObject({ key: 'ariza_turu', required: true, helpText: null });
  });

  it('patches a question without key or type, and deactivates instead of deleting', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, {})));
    await updateCategoryQuestion(
      {},
      form({ categoryId: CAT, questionId: Q, draft: JSON.stringify(draft) }),
    );
    expect(lastCall().method).toBe('PATCH');
    expect(lastCall().url).toMatch(new RegExp(`/admin/category-questions/${Q}$`));
    expect(lastCall().body).not.toHaveProperty('key');
    expect(lastCall().body).not.toHaveProperty('type');

    await setCategoryQuestionActive(
      {},
      form({ categoryId: CAT, questionId: Q, isActive: 'false' }),
    );
    expect(lastCall()).toMatchObject({ method: 'PATCH', body: { isActive: false } });
  });

  it('checks aliases and the photo policy', async () => {
    expect(await addCategoryAlias({}, form({ categoryId: CAT, alias: 'k' }))).toEqual({
      error: 'Eş anlamlı ifade 2–80 karakter olmalı.',
    });
    expect(
      await setCategoryPhotoPolicy({}, form({ categoryId: CAT, requestPhotoPolicy: 'ALWAYS' })),
    ).toEqual({ error: 'Bir fotoğraf politikası seçin.' });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, {})));
    await setCategoryPhotoPolicy({}, form({ categoryId: CAT, requestPhotoPolicy: 'REQUIRED' }));
    expect(lastCall()).toMatchObject({ method: 'PATCH', body: { requestPhotoPolicy: 'REQUIRED' } });
    expect(lastCall().url).toMatch(new RegExp(`/categories/${CAT}$`));
  });
});

describe('message reports', () => {
  const report = {
    id: REPORT,
    messageId: MSG,
    conversationId: CONV,
    reason: 'HARASSMENT',
    note: null,
    status: 'OPEN',
    reporterRole: 'CUSTOMER',
    createdAt: '2026-09-30T10:00:00.000Z',
    reviewedAt: null,
  };

  it('refuses a short reason without calling the API', async () => {
    expect(
      await accessReportedConversation({}, form({ reportId: REPORT, reason: 'bakalım' })),
    ).toEqual({ error: 'Gerekçe en az 10 karakter olmalı.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the reason and returns the messages uncached', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        report,
        messages: [
          {
            id: MSG,
            conversationId: CONV,
            type: 'TEXT',
            senderRole: 'PROVIDER',
            mine: false,
            body: 'Merhaba',
            hasImage: false,
            clientMessageId: null,
            containsContactInfo: false,
            state: 'READ',
            createdAt: '2026-09-30T09:00:00.000Z',
            deletedAt: null,
            senderName: 'Ali U.',
          },
        ],
      }),
    );
    const result = await accessReportedConversation(
      {},
      form({ reportId: REPORT, reason: '  Taciz şikayeti incelemesi  ' }),
    );
    expect(lastCall()).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      body: { reason: 'Taciz şikayeti incelemesi' },
    });
    expect(lastCall().url).toMatch(new RegExp(`/admin/message-reports/${REPORT}/access$`));
    expect(result.ok).toBe(true);
    expect(result.conversation?.messages[0]?.body).toBe('Merhaba');
  });

  it('resolves with a decision and a note', async () => {
    expect(
      await resolveMessageReport({}, form({ reportId: REPORT, status: 'CLOSED', note: 'Tamam.' })),
    ).toEqual({ error: 'Bir karar seçin.' });
    expect(
      await resolveMessageReport({}, form({ reportId: REPORT, status: 'DISMISSED', note: 'x' })),
    ).toEqual({ error: 'Not 3–500 karakter olmalı.' });

    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, report)));
    expect(
      await resolveMessageReport(
        {},
        form({ reportId: REPORT, status: 'DISMISSED', note: 'İhlal yok.' }),
      ),
    ).toEqual({ ok: true });
    expect(lastCall().body).toEqual({ status: 'DISMISSED', note: 'İhlal yok.' });
  });
});
