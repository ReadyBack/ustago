import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchMock, jsonResponse, mockCookies } from '../../../test/setup-mocks';

vi.mock('server-only', () => ({}));
const cookies = mockCookies({ ustago_admin_at: 'admin-at', ustago_admin_rt: 'admin-rt' });
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve(cookies.store) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.stubGlobal('fetch', fetchMock);

const { decidePayout, refundPayment, resolveCash } = await import('./actions');

const ID = '0190a000-0000-7000-8000-00000000000a';
const KEY = '0190a0000000700080000000000000ff';

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
    headers: new Headers(init?.headers),
    body: init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown),
  };
}

const apiError = (status: number, code: string, details?: unknown) =>
  jsonResponse(status, {
    statusCode: status,
    code,
    message: 'x',
    details,
    path: '/',
    timestamp: new Date().toISOString(),
  });

const refund = (overrides: Record<string, string> = {}) =>
  form({
    id: ID,
    idempotencyKey: KEY,
    expectedRefundableMinor: '150000',
    amount: '1.000,50',
    reason: 'SERVICE_ISSUE',
    note: 'Müşteri işin yarım kaldığını bildirdi.',
    ...overrides,
  });

describe('refundPayment', () => {
  beforeEach(() => fetchMock.mockReset());

  it('refuses tampered ids and missing idempotency keys without calling the API', async () => {
    expect(await refundPayment({}, refund({ id: '../x' }))).toEqual({ error: 'Geçersiz istek.' });
    expect(await refundPayment({}, refund({ idempotencyKey: '' }))).toEqual({
      error: 'Geçersiz istek.',
    });
    expect(await refundPayment({}, refund({ idempotencyKey: 'bad key!' }))).toEqual({
      error: 'Geçersiz istek.',
    });
    expect(await refundPayment({}, refund({ expectedRefundableMinor: '1.5' }))).toEqual({
      error: 'Geçersiz istek.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires an internal note, a reason and a valid amount', async () => {
    expect((await refundPayment({}, refund({ note: '' }))).error).toMatch(/İç not zorunludur/);
    expect((await refundPayment({}, refund({ reason: 'JOB_CANCELLED' }))).error).toBeTruthy();
    expect((await refundPayment({}, refund({ amount: '-50' }))).error).toMatch(
      /geçerli bir tutar/i,
    );
    expect((await refundPayment({}, refund({ amount: '0' }))).error).toMatch(/geçerli bir tutar/i);
    expect((await refundPayment({}, refund({ amount: '1.500,01' }))).error).toMatch(/aşıyor/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends kuruş, the confirmed refundable amount and the Idempotency-Key', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    const state = await refundPayment({}, refund());
    expect(state).toEqual({ ok: true });
    const call = lastCall();
    expect(call.url).toMatch(new RegExp(`/api/v1/admin/finance/payments/${ID}/refunds$`));
    expect(call.method).toBe('POST');
    expect(call.headers.get('Idempotency-Key')).toBe(KEY);
    expect(call.headers.get('Authorization')).toBe('Bearer admin-at');
    expect(call.body).toEqual({
      amountMinor: 100050,
      reason: 'SERVICE_ISSUE',
      note: 'Müşteri işin yarım kaldığını bildirdi.',
      expectedRefundableMinor: 150000,
    });
  });

  it('reuses the same key when the form is submitted twice', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, {})));
    await refundPayment({}, refund());
    await refundPayment({}, refund());
    const keys = fetchMock.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get('Idempotency-Key'),
    );
    expect(keys).toEqual([KEY, KEY]);
  });

  it('maps REFUND_STALE and other refund errors to Turkish messages', async () => {
    fetchMock.mockResolvedValueOnce(apiError(409, 'REFUND_STALE', { refundableMinor: 50000 }));
    expect(await refundPayment({}, refund())).toEqual({
      error: 'Tutar değişti, sayfayı yenileyip tekrar kontrol edin.',
    });
    fetchMock.mockResolvedValueOnce(apiError(422, 'REFUND_EXCEEDS_REFUNDABLE'));
    expect((await refundPayment({}, refund())).error).toMatch(/aşıyor/);
    fetchMock.mockResolvedValueOnce(apiError(409, 'REFUND_NOT_ALLOWED'));
    expect((await refundPayment({}, refund())).error).toMatch(/iade edilemez/);
  });
});

describe('decidePayout', () => {
  beforeEach(() => fetchMock.mockReset());

  it('refuses unknown decisions', async () => {
    expect(await decidePayout({}, form({ id: ID, decision: 'pay-twice' }))).toEqual({
      error: 'Geçersiz istek.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('approves, cancels and uses the dev-only TEST endpoints', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, {})));
    await decidePayout({}, form({ id: ID, decision: 'approve' }));
    expect(lastCall().url).toMatch(new RegExp(`/admin/finance/payouts/${ID}/approve$`));
    expect(lastCall().body).toBeUndefined();
    await decidePayout({}, form({ id: ID, decision: 'cancel', note: 'IBAN hatalı' }));
    expect(lastCall().url).toMatch(new RegExp(`/admin/finance/payouts/${ID}/cancel$`));
    expect(lastCall().body).toEqual({ note: 'IBAN hatalı' });
    await decidePayout({}, form({ id: ID, decision: 'cancel', note: '' }));
    expect(lastCall().body).toEqual({});
    await decidePayout({}, form({ id: ID, decision: 'mark-paid' }));
    expect(lastCall().url).toMatch(new RegExp(`/admin/dev/payouts/${ID}/mark-paid$`));
    await decidePayout({}, form({ id: ID, decision: 'mark-failed' }));
    expect(lastCall().url).toMatch(new RegExp(`/admin/dev/payouts/${ID}/mark-failed$`));
  });

  it('translates a state conflict', async () => {
    fetchMock.mockResolvedValueOnce(apiError(409, 'PAYOUT_INVALID_STATE'));
    const state = await decidePayout({}, form({ id: ID, decision: 'approve' }));
    expect(state.error).toMatch(/durumu değişmiş/);
  });
});

describe('resolveCash', () => {
  beforeEach(() => fetchMock.mockReset());

  it('needs an outcome and a note', async () => {
    const state = await resolveCash({}, form({ id: ID, outcome: 'CONFIRM_PAID', note: '' }));
    expect(state.error).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves a disputed cash payment', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    const state = await resolveCash(
      {},
      form({ id: ID, outcome: 'MARK_UNPAID', note: 'Müşteri ödeme yapmadı.' }),
    );
    expect(state).toEqual({ ok: true });
    expect(lastCall().url).toMatch(new RegExp(`/admin/finance/cash-settlements/${ID}/resolve$`));
    expect(lastCall().body).toEqual({ outcome: 'MARK_UNPAID', note: 'Müşteri ödeme yapmadı.' });
  });
});
