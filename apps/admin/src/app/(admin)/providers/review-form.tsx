'use client';

import { colors, spacing } from '@ustago/ui';
import { useActionState } from 'react';

import { review, type ReviewState } from './actions';

interface Props {
  target: 'provider' | 'verification';
  id: string;
  providerId: string;
  decision: 'approve' | 'reject' | 'suspend' | 'reinstate';
  label: string;
  tone?: 'primary' | 'danger';
  withReason?: boolean;
  reasonPlaceholder?: string;
}

/** A review button; rejections and suspensions also ask for a reason. */
export function ReviewForm(props: Props) {
  const [state, action, pending] = useActionState<ReviewState, FormData>(review, {});

  return (
    <form action={action} style={{ display: 'grid', gap: spacing.xs }}>
      <input type="hidden" name="target" value={props.target} />
      <input type="hidden" name="id" value={props.id} />
      <input type="hidden" name="providerId" value={props.providerId} />
      <input type="hidden" name="decision" value={props.decision} />
      {props.withReason ? (
        <textarea
          name="reason"
          required
          minLength={5}
          maxLength={1000}
          rows={2}
          placeholder={props.reasonPlaceholder ?? 'Sebep (ustaya gösterilir)'}
          aria-label="Sebep"
        />
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className={`btn${props.tone ? ` btn-${props.tone}` : ''}`}
      >
        {pending ? 'Kaydediliyor…' : props.label}
      </button>
      {state.error ? (
        <p role="alert" style={{ color: colors.emergency, fontSize: 14 }}>
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
