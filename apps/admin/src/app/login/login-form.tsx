'use client';

import { colors, radii, spacing } from '@ustago/ui';
import { useActionState } from 'react';

import { login, type LoginState } from './actions';

const input = {
  padding: `${spacing.sm + 4}px ${spacing.md}px`,
  borderRadius: radii.sm,
  border: `1px solid ${colors.border}`,
  fontSize: 16,
} as const;

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {
    error: initialError,
  });

  return (
    <form action={action} style={{ display: 'grid', gap: spacing.md }} noValidate>
      <input type="hidden" name="next" value={next} />
      <label style={{ display: 'grid', gap: spacing.xs }}>
        E-posta
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={state.email}
          style={input}
        />
      </label>
      <label style={{ display: 'grid', gap: spacing.xs }}>
        Şifre
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          style={input}
        />
      </label>
      {state.error ? (
        <p role="alert" style={{ color: colors.emergency }}>
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? 'Giriş yapılıyor…' : 'Giriş yap'}
      </button>
    </form>
  );
}
