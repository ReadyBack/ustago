import 'server-only';

import type { CurrentUser } from '@ustago/types';
import { currentUserSchema } from '@ustago/validation';
import { redirect } from 'next/navigation';

import { apiRequest } from './api';
import { readSession } from './session';

export const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'] as const;

export function isAdmin(user: Pick<CurrentUser, 'roles'>): boolean {
  return user.roles.some((role) => (ADMIN_ROLES as readonly string[]).includes(role));
}

/**
 * Every admin page calls this. The API decides who the caller is; the
 * cookie alone proves nothing. An expired access token is renewed by the
 * refresh route, which then comes back to `currentPath`.
 */
export async function requireAdmin(currentPath: string): Promise<CurrentUser> {
  const { accessToken, refreshToken } = await readSession();
  if (!accessToken) {
    if (refreshToken) redirect(`/auth/refresh?next=${encodeURIComponent(currentPath)}`);
    redirect('/login');
  }
  const me = await apiRequest('/me', { schema: currentUserSchema });
  if (!me.ok) {
    if (me.status === 401) redirect(`/auth/refresh?next=${encodeURIComponent(currentPath)}`);
    throw new Error(me.message);
  }
  if (!isAdmin(me.data)) redirect('/login?error=forbidden');
  return me.data;
}

/** The signed-in admin, or null (no redirect); for the layout shell. */
export async function currentAdmin(): Promise<CurrentUser | null> {
  const { accessToken } = await readSession();
  if (!accessToken) return null;
  const me = await apiRequest('/me', { schema: currentUserSchema });
  return me.ok && isAdmin(me.data) ? me.data : null;
}
