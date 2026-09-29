import { type NextRequest, NextResponse } from 'next/server';

import { refreshSession } from '@/lib/api';
import { safeNextPath } from '@/lib/safe-redirect';
import { clearSessionCookies } from '@/lib/session';

/**
 * Renews an expired access token with the refresh cookie, then returns to
 * the page the admin was on. Pages cannot write cookies while rendering,
 * so they send the browser here instead.
 */
export async function GET(request: NextRequest) {
  const next = safeNextPath(request.nextUrl.searchParams.get('next'));
  if (await refreshSession()) {
    return NextResponse.redirect(new URL(next, request.url));
  }
  await clearSessionCookies();
  const login = new URL('/login', request.url);
  login.searchParams.set('error', 'expired');
  login.searchParams.set('next', next);
  return NextResponse.redirect(login);
}
