import 'server-only';

import type { AuthTokens } from '@ustago/types';
import { cookies } from 'next/headers';

import { serverEnv } from './env';

/**
 * The admin session lives in two httpOnly, SameSite=Strict cookies that
 * JavaScript in the browser can never read (docs/adr/0013). Only this
 * server talks to the API with the tokens.
 */
export const ACCESS_COOKIE = 'ustago_admin_at';
export const REFRESH_COOKIE = 'ustago_admin_rt';

const baseCookie = {
  httpOnly: true,
  sameSite: 'strict' as const,
  path: '/',
};

function secondsUntil(iso: string): number {
  return Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
}

/** Callable only from Server Actions and Route Handlers. */
export async function setSessionCookies(tokens: AuthTokens): Promise<void> {
  const store = await cookies();
  const secure = serverEnv.cookieSecure;
  store.set(ACCESS_COOKIE, tokens.accessToken, {
    ...baseCookie,
    secure,
    maxAge: secondsUntil(tokens.accessTokenExpiresAt),
  });
  store.set(REFRESH_COOKIE, tokens.refreshToken, {
    ...baseCookie,
    secure,
    maxAge: secondsUntil(tokens.refreshTokenExpiresAt),
  });
}

export async function clearSessionCookies(): Promise<void> {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
}

export async function readSession(): Promise<{ accessToken?: string; refreshToken?: string }> {
  const store = await cookies();
  return {
    accessToken: store.get(ACCESS_COOKIE)?.value,
    refreshToken: store.get(REFRESH_COOKIE)?.value,
  };
}
