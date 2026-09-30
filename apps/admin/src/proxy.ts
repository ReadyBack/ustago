import { type NextRequest, NextResponse } from 'next/server';

const ACCESS_COOKIE = 'ustago_admin_at';
const REFRESH_COOKIE = 'ustago_admin_rt';

/**
 * Optimistic check only: without any session cookie there is no point in
 * rendering an admin page. The real check (a valid token with the ADMIN
 * role) happens on the server for every page and action via the API.
 */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has(ACCESS_COOKIE) || request.cookies.has(REFRESH_COOKIE);
  if (hasSession) return NextResponse.next();
  const login = new URL('/login', request.url);
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (next !== '/') login.searchParams.set('next', next);
  return NextResponse.redirect(login);
}

export const config = {
  // Brand files, icons and the web manifest are public so the login page and
  // installed app can show them before sign-in.
  matcher: [
    '/((?!login|auth/|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|manifest.webmanifest|brand/).*)',
  ],
};
