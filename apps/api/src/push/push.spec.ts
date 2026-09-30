import { maskToken } from './console-push.provider.js';
import { ExpoPushProvider } from './expo-push.provider.js';
import { isDeadTokenError, isRetryableTicketError, PushTransportError } from './push-provider.js';
import { backoffSeconds, retryDecision } from './push-retry.js';

const TOKEN_A = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const TOKEN_B = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('push retry policy', () => {
  it('backs off exponentially from 30 s and caps at one hour', () => {
    expect(backoffSeconds(1)).toBe(30);
    expect(backoffSeconds(2)).toBe(60);
    expect(backoffSeconds(3)).toBe(120);
    expect(backoffSeconds(20)).toBe(3600);
  });

  it('stops after the attempt limit (no infinite retry)', () => {
    const now = new Date('2026-10-01T12:00:00Z');
    expect(retryDecision(1, 5, now)).toEqual({
      retry: true,
      nextAttemptAt: new Date('2026-10-01T12:00:30Z'),
    });
    expect(retryDecision(5, 5, now)).toEqual({ retry: false });
  });

  it('classifies Expo error codes', () => {
    expect(isDeadTokenError('DeviceNotRegistered')).toBe(true);
    expect(isDeadTokenError('MessageTooBig')).toBe(false);
    expect(isRetryableTicketError('MessageRateExceeded')).toBe(true);
    expect(isRetryableTicketError('DeviceNotRegistered')).toBe(false);
  });

  it('masks tokens in logs', () => {
    expect(maskToken(TOKEN_A)).toBe('ExponentPushToken[aaaa…]');
    expect(maskToken(TOKEN_A)).not.toContain('aaaaaaaaaa');
  });
});

describe('ExpoPushProvider', () => {
  it('sends valid tokens and maps tickets in order; malformed tokens never leave', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const provider = new ExpoPushProvider('token', (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return Promise.resolve(
        jsonResponse(200, {
          data: [
            { status: 'ok', id: 'ticket-a' },
            { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
          ],
        }),
      );
    });
    const tickets = await provider.send([
      { to: TOKEN_A, title: 't', body: 'b', data: { jobId: 'j' } },
      { to: 'not-a-token', title: 't', body: 'b' },
      { to: TOKEN_B, title: 't', body: 'b' },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://exp.host/--/api/v2/push/send');
    expect((calls[0]?.body as unknown[]).length).toBe(2);
    expect(tickets).toEqual([
      { status: 'ok', ticketId: 'ticket-a' },
      { status: 'error', error: 'InvalidExpoPushToken', message: 'Not an Expo push token' },
      { status: 'error', error: 'DeviceNotRegistered', message: 'gone' },
    ]);
  });

  it('treats 5xx and network failures as retryable, 4xx as final', async () => {
    const failing = (status: number) =>
      new ExpoPushProvider(undefined, () => Promise.resolve(jsonResponse(status, { errors: [] })));
    await expect(failing(503).send([{ to: TOKEN_A, title: 't', body: 'b' }])).rejects.toMatchObject(
      {
        retryable: true,
      },
    );
    await expect(failing(401).send([{ to: TOKEN_A, title: 't', body: 'b' }])).rejects.toMatchObject(
      {
        retryable: false,
      },
    );
    const offline = new ExpoPushProvider(undefined, () => Promise.reject(new Error('ECONNRESET')));
    await expect(offline.send([{ to: TOKEN_A, title: 't', body: 'b' }])).rejects.toBeInstanceOf(
      PushTransportError,
    );
  });

  it('reads receipts', async () => {
    const provider = new ExpoPushProvider(undefined, () =>
      Promise.resolve(
        jsonResponse(200, {
          data: {
            r1: { status: 'ok' },
            r2: { status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } },
          },
        }),
      ),
    );
    const receipts = await provider.receipts(['r1', 'r2', 'r3']);
    expect(receipts.get('r1')).toEqual({ status: 'ok' });
    expect(receipts.get('r2')).toEqual({
      status: 'error',
      error: 'DeviceNotRegistered',
      message: 'x',
    });
    expect(receipts.has('r3')).toBe(false);
  });
});
