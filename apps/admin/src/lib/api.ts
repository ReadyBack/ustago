import 'server-only';

import { apiErrorResponseSchema, authTokensSchema } from '@ustago/validation';
import type { z } from 'zod';

import { serverEnv } from './env';
import { readSession, setSessionCookies } from './session';

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; code: string; message: string; details?: unknown };

interface RequestOptions<S extends z.ZodType | undefined> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  schema?: S;
  /** Uses this token instead of the session cookie (login, logout). */
  accessToken?: string | null;
}

type Data<S> = S extends z.ZodType ? z.infer<S> : undefined;

/**
 * Server-side call to the UstaGO API. Responses are validated with the
 * shared Zod schemas, so a contract drift fails loudly here instead of
 * rendering garbage.
 */
export async function apiRequest<S extends z.ZodType | undefined = undefined>(
  path: string,
  options: RequestOptions<S> = {},
): Promise<ApiResult<Data<S>>> {
  const token =
    options.accessToken === undefined ? (await readSession()).accessToken : options.accessToken;
  let res: Response;
  try {
    res = await fetch(`${serverEnv.ADMIN_API_URL}/api/v1${path}`, {
      method: options.method ?? 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, status: 503, code: 'API_UNREACHABLE', message: 'API’ye ulaşılamıyor.' };
  }

  const text = await res.text();
  const json: unknown = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const error = apiErrorResponseSchema.safeParse(json);
    return error.success
      ? {
          ok: false,
          status: res.status,
          code: error.data.code,
          message: error.data.message,
          details: error.data.details,
        }
      : {
          ok: false,
          status: res.status,
          code: 'HTTP_ERROR',
          message: `API hatası (${res.status}).`,
        };
  }
  if (!options.schema) return { ok: true, status: res.status, data: undefined as Data<S> };
  const parsed = options.schema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      status: 502,
      code: 'CONTRACT_MISMATCH',
      message: 'API yanıtı beklenen biçimde değil.',
    };
  }
  return { ok: true, status: res.status, data: parsed.data as Data<S> };
}

/**
 * Rotates the session with the refresh cookie. Only callable where cookies
 * can be written (Server Actions, Route Handlers). Returns false when the
 * session is over.
 */
export async function refreshSession(): Promise<boolean> {
  const { refreshToken } = await readSession();
  if (!refreshToken) return false;
  const result = await apiRequest('/auth/refresh', {
    method: 'POST',
    body: { refreshToken },
    schema: authTokensSchema,
    accessToken: null,
  });
  if (!result.ok) return false;
  await setSessionCookies(result.data);
  return true;
}

/** In a Server Action: call, and on 401 refresh once and retry. */
export async function apiAction<S extends z.ZodType | undefined = undefined>(
  path: string,
  options: RequestOptions<S> = {},
): Promise<ApiResult<Data<S>>> {
  const first = await apiRequest(path, options);
  if (first.ok || first.status !== 401 || options.accessToken !== undefined) return first;
  if (!(await refreshSession())) return first;
  return apiRequest(path, options);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
