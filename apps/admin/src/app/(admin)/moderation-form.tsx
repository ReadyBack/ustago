'use client';

import { colors, spacing } from '@ustago/ui';
import { type ReactNode, useActionState } from 'react';

import type { ModerationState } from './moderation-actions';

interface Props {
  action: (prev: ModerationState, form: FormData) => Promise<ModerationState>;
  hidden: Record<string, string>;
  submitLabel: string;
  tone?: 'primary' | 'danger';
  /** Extra fields (selects, reason textarea). */
  children?: ReactNode;
  /** Shown after success, e.g. "Sonuçlandırıldı". */
  doneMessage?: string;
  label: string;
}

/** One form for every moderation decision; the API enforces the rules. */
export function ModerationForm(props: Props) {
  const [state, action, pending] = useActionState<ModerationState, FormData>(props.action, {});
  return (
    <form action={action} aria-label={props.label} style={{ display: 'grid', gap: spacing.xs }}>
      {Object.entries(props.hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {props.children}
      <button
        type="submit"
        disabled={pending}
        className={`btn${props.tone ? ` btn-${props.tone}` : ''}`}
      >
        {pending ? 'Kaydediliyor…' : props.submitLabel}
      </button>
      {state.error ? (
        <p role="alert" style={{ color: colors.emergency, fontSize: 14 }}>
          {state.error}
        </p>
      ) : null}
      {state.ok && props.doneMessage ? (
        <p role="status" style={{ color: colors.success, fontSize: 14 }}>
          {props.doneMessage}
        </p>
      ) : null}
    </form>
  );
}
