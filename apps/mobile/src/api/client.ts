import type { AuthTokens } from '@ustago/types';

/** An API error with the server's code and its user-safe Turkish message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Seconds to wait, when the server sent details.retryAfterSeconds. */
  get retryAfterSeconds(): number | null {
    const d = this.details;
    if (d && typeof d === 'object' && 'retryAfterSeconds' in d) {
      const value = (d as { retryAfterSeconds: unknown }).retryAfterSeconds;
      return typeof value === 'number' ? value : null;
    }
    return null;
  }
}

export const NETWORK_ERROR_MESSAGE =
  'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin; yerel geliştirmede API’nin çalıştığından emin olun.';

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.';
}

export interface TokenHooks {
  getTokens: () => AuthTokens | null;
  setTokens: (tokens: AuthTokens | null) => Promise<void>;
  /** Called once when a refresh fails: the session is over. */
  onSessionExpired: () => void;
  /**
   * Resolves once the stored session has been read at start-up; authenticated
   * requests wait for it so a screen that mounts early never goes out
   * without its token.
   */
  ready?: () => Promise<void>;
}

export interface RequestOptions {
  body?: unknown;
  /** Send the access token (default true). */
  auth?: boolean;
  signal?: AbortSignal;
  /** Extra headers, e.g. Idempotency-Key. */
  headers?: Record<string, string>;
}

type Fetch = typeof fetch;

/**
 * JSON client for /api/v1. On a 401 it refreshes the tokens once and
 * retries; concurrent 401s share one refresh (single-flight), because the
 * server rotates refresh tokens and a second refresh with the old token
 * would be treated as reuse and end the session.
 */
export class ApiClient {
  private refreshing: Promise<AuthTokens | null> | null = null;

  constructor(
    readonly baseUrl: string,
    private readonly hooks: TokenHooks,
    private readonly fetchImpl: Fetch = (input, init) => fetch(input, init),
  ) {}

  get<T>(path: string, options?: RequestOptions) {
    return this.request<T>('GET', path, options);
  }
  post<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>('POST', path, { ...options, body });
  }
  patch<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>('PATCH', path, { ...options, body });
  }
  put<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>('PUT', path, { ...options, body });
  }
  delete<T>(path: string, options?: RequestOptions) {
    return this.request<T>('DELETE', path, options);
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const auth = options.auth ?? true;
    if (auth && this.hooks.ready) await this.hooks.ready();
    const tokens = auth ? this.hooks.getTokens() : null;
    let res = await this.send(method, path, options, tokens?.accessToken);
    if (res.status === 401 && auth && tokens) {
      const fresh = await this.refresh(tokens);
      if (!fresh) {
        throw new ApiError(
          401,
          'SESSION_EXPIRED',
          'Oturumunuz sona erdi. Lütfen tekrar giriş yapın.',
        );
      }
      res = await this.send(method, path, options, fresh.accessToken);
    }
    return this.parse<T>(res);
  }

  /** Reads a local file (uri from the image/document picker) into a Blob. */
  async readFile(fileUri: string): Promise<Blob> {
    try {
      return await (await this.fetchImpl(fileUri)).blob();
    } catch {
      throw new ApiError(0, 'FILE_READ_FAILED', 'Dosya okunamadı. Lütfen başka bir dosya seçin.');
    }
  }

  /** PUTs a file to a signed upload URL from an upload intent. */
  async upload(url: string, body: Blob, headers: Record<string, string>): Promise<void> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.reachable(url), { method: 'PUT', headers, body });
    } catch {
      throw new ApiError(0, 'NETWORK_ERROR', NETWORK_ERROR_MESSAGE);
    }
    if (!res.ok) await this.parse<unknown>(res);
  }

  /**
   * Signed storage links use STORAGE_PUBLIC_BASE_URL (localhost in local
   * development), which a phone cannot reach. Such links are pointed at the
   * API origin the app already talks to; any other host is left alone.
   */
  reachable(url: string): string {
    const match = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/.exec(url);
    return match ? `${this.baseUrl}${match[3] ?? ''}` : url;
  }

  private async send(
    method: string,
    path: string,
    options: RequestOptions,
    accessToken: string | undefined,
  ): Promise<Response> {
    const headers: Record<string, string> = { ...options.headers, Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    try {
      return await this.fetchImpl(`${this.baseUrl}/api/v1${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw new ApiError(0, 'NETWORK_ERROR', NETWORK_ERROR_MESSAGE);
    }
  }

  private async parse<T>(res: Response): Promise<T> {
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    if (res.ok) return data as T;
    const body = (data ?? {}) as { code?: unknown; message?: unknown; details?: unknown };
    throw new ApiError(
      res.status,
      typeof body.code === 'string' ? body.code : `HTTP_${res.status}`,
      typeof body.message === 'string' && body.message
        ? body.message
        : 'İşlem tamamlanamadı. Lütfen tekrar deneyin.',
      body.details,
    );
  }

  private refresh(expired: AuthTokens): Promise<AuthTokens | null> {
    this.refreshing ??= this.doRefresh(expired).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(expired: AuthTokens): Promise<AuthTokens | null> {
    // Another request may have refreshed already while this one was in flight.
    const current = this.hooks.getTokens();
    if (current && current.accessToken !== expired.accessToken) return current;
    if (!current) return null;
    try {
      const res = await this.send(
        'POST',
        '/auth/refresh',
        {
          body: { refreshToken: current.refreshToken },
        },
        undefined,
      );
      if (!res.ok) {
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          await this.hooks.setTokens(null);
          this.hooks.onSessionExpired();
        }
        return null;
      }
      const tokens = (await res.json()) as AuthTokens;
      if (typeof tokens.accessToken !== 'string') return null;
      await this.hooks.setTokens(tokens);
      return tokens;
    } catch {
      return null;
    }
  }
}
