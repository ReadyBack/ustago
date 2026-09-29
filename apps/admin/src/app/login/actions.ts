'use server';

import { authResponseSchema, loginRequestSchema } from '@ustago/validation';
import { redirect } from 'next/navigation';

import { apiRequest } from '@/lib/api';
import { isAdmin } from '@/lib/auth';
import { safeNextPath } from '@/lib/safe-redirect';
import { clearSessionCookies, readSession, setSessionCookies } from '@/lib/session';

export interface LoginState {
  error?: string;
  email?: string;
}

/**
 * Signs in through the API and keeps the tokens in httpOnly cookies.
 * Server Actions only accept same-origin POSTs (Next.js compares Origin
 * and Host), and the cookies are SameSite=Strict (docs/adr/0013).
 */
export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '');
  const input = loginRequestSchema.safeParse({
    email,
    password: String(formData.get('password') ?? ''),
  });
  if (!input.success) return { error: 'E-posta ve şifrenizi kontrol edin.', email };

  const result = await apiRequest('/auth/login', {
    method: 'POST',
    body: input.data,
    schema: authResponseSchema,
    accessToken: null,
  });
  if (!result.ok) {
    return {
      error: result.code === 'INVALID_CREDENTIALS' ? 'E-posta veya şifre hatalı.' : result.message,
      email,
    };
  }
  if (!isAdmin(result.data.user)) {
    // Do not leave a session behind for an account that cannot use the panel.
    await apiRequest('/auth/logout', {
      method: 'POST',
      accessToken: result.data.tokens.accessToken,
    });
    return { error: 'Bu hesabın yönetim paneline erişim yetkisi yok.', email };
  }
  await setSessionCookies(result.data.tokens);
  redirect(safeNextPath(formData.get('next')));
}

export async function logout(): Promise<void> {
  const { accessToken } = await readSession();
  if (accessToken) {
    await apiRequest('/auth/logout', { method: 'POST', accessToken });
  }
  await clearSessionCookies();
  redirect('/login');
}
