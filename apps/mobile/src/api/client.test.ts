import type { AuthTokens } from '@ustago/types';

import { ApiClient, ApiError, type TokenHooks } from './client';

const tokens = (n: number): AuthTokens => ({
  tokenType: 'Bearer',
  accessToken: `access-${n}`,
  accessTokenExpiresAt: '2030-01-01T00:00:00.000Z',
  refreshToken: `refresh-${n}`,
  refreshTokenExpiresAt: '2030-01-01T00:00:00.000Z',
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

interface Call {
  url: string;
  auth: string | undefined;
  body: string | undefined;
}

/** A fake server: /auth/refresh rotates the tokens; other paths need the current access token. */
function setup(initial: AuthTokens | null, refreshStatus = 200) {
  let current = initial;
  let issued = 1;
  const calls: Call[] = [];
  const hooks: TokenHooks = {
    getTokens: () => current,
    setTokens: jest.fn(async (next: AuthTokens | null) => {
      current = next;
    }),
    onSessionExpired: jest.fn(),
  };
  const fetchImpl = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ url, auth: headers.Authorization, body });
    // Let concurrent requests pile up before answering, like a real network.
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (url.endsWith('/auth/refresh')) {
      if (refreshStatus !== 200) return json(refreshStatus, { code: 'REFRESH_TOKEN_INVALID' });
      issued += 1;
      return json(200, tokens(issued));
    }
    if (headers.Authorization !== `Bearer access-${issued}`) {
      return json(401, { code: 'UNAUTHORIZED', message: 'Oturum gerekli.' });
    }
    return json(200, { ok: true, url });
  });
  const client = new ApiClient('http://api.test', hooks, fetchImpl);
  return { client, hooks, calls, current: () => current };
}

describe('ApiClient', () => {
  it('sends the bearer token and parses JSON', async () => {
    const { client, calls } = setup(tokens(1));
    await expect(client.get('/me')).resolves.toEqual({
      ok: true,
      url: 'http://api.test/api/v1/me',
    });
    expect(calls[0]?.auth).toBe('Bearer access-1');
  });

  it('refreshes once on 401 and retries the request', async () => {
    const { client, calls, current } = setup({ ...tokens(1), accessToken: 'stale' });
    await expect(client.get('/me')).resolves.toMatchObject({ ok: true });
    expect(calls.map((c) => c.url.replace('http://api.test/api/v1', ''))).toEqual([
      '/me',
      '/auth/refresh',
      '/me',
    ]);
    expect(calls[1]?.body).toBe(JSON.stringify({ refreshToken: 'refresh-1' }));
    expect(current()?.accessToken).toBe('access-2');
  });

  it('shares one refresh between concurrent 401s (single-flight)', async () => {
    const { client, calls } = setup({ ...tokens(1), accessToken: 'stale' });
    const results = await Promise.all([client.get('/a'), client.get('/b'), client.get('/c')]);
    expect(results).toHaveLength(3);
    expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('ends the session when the refresh token is rejected', async () => {
    const { client, hooks } = setup({ ...tokens(1), accessToken: 'stale' }, 401);
    await expect(client.get('/me')).rejects.toMatchObject({ status: 401, code: 'SESSION_EXPIRED' });
    expect(hooks.setTokens).toHaveBeenCalledWith(null);
    expect(hooks.onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('does not refresh for unauthenticated calls', async () => {
    const { client, calls } = setup(null);
    await expect(client.post('/auth/otp/request', {}, { auth: false })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(calls).toHaveLength(1);
  });

  it('maps server errors and network failures to ApiError', async () => {
    const failing = new ApiClient(
      'http://api.test',
      {
        getTokens: () => null,
        setTokens: async () => undefined,
        onSessionExpired: () => undefined,
      },
      async () =>
        json(429, {
          code: 'OTP_RATE_LIMITED',
          message: 'Çok sık istek.',
          details: { retryAfterSeconds: 120 },
        }),
    );
    const error = await failing.get('/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: 'OTP_RATE_LIMITED', retryAfterSeconds: 120 });

    const offline = new ApiClient(
      'http://api.test',
      {
        getTokens: () => null,
        setTokens: async () => undefined,
        onSessionExpired: () => undefined,
      },
      async () => {
        throw new TypeError('Network request failed');
      },
    );
    await expect(offline.get('/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });

  it('points localhost signed URLs at the API origin the device can reach', () => {
    const { client } = setup(null);
    expect(client.reachable('http://localhost:3000/api/v1/uploads/local/abc?sig=1')).toBe(
      'http://api.test/api/v1/uploads/local/abc?sig=1',
    );
    expect(client.reachable('https://cdn.example.com/x')).toBe('https://cdn.example.com/x');
  });
});

describe('ApiClient start-up', () => {
  it('holds authenticated requests until the stored session is restored', async () => {
    let restore: () => void = () => undefined;
    const restored = new Promise<void>((resolve) => {
      restore = resolve;
    });
    let current: AuthTokens | null = null;
    const seen: (string | undefined)[] = [];
    const client = new ApiClient(
      'http://api.test',
      {
        getTokens: () => current,
        setTokens: async () => undefined,
        onSessionExpired: () => undefined,
        ready: () => restored,
      },
      async (_input, init) => {
        seen.push(((init?.headers ?? {}) as Record<string, string>).Authorization);
        return json(200, {});
      },
    );
    const pending = client.get('/me/service-requests');
    await client.get('/catalog/categories', { auth: false });
    current = tokens(1);
    restore();
    await pending;
    expect(seen).toEqual([undefined, 'Bearer access-1']);
  });
});
