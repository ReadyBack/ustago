'use client';

import { colors, spacing } from '@ustago/ui';
import { useActionState, useRef, useState } from 'react';

import type { ActionState } from '@/lib/form-action';
import { LAUNCH_STATUS_HINTS, LAUNCH_STATUS_LABELS } from '@/lib/labels';
import { LAUNCH_STATUSES, type LaunchStatus } from '@/lib/marketplace';

import { setProvinceLaunchStatus } from '../../marketplace-actions';

/**
 * Pick a new launch status, then confirm it in a dialog that spells out the
 * effect. The form posts `confirm=yes` only from the dialog's button.
 */
export function LaunchStatusControl(props: {
  provinceId: number;
  provinceName: string;
  current: LaunchStatus;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    setProvinceLaunchStatus,
    {},
  );
  const [next, setNext] = useState<LaunchStatus>(props.current);
  const dialog = useRef<HTMLDialogElement>(null);

  return (
    <form
      action={(form) => {
        dialog.current?.close();
        action(form);
      }}
      aria-label={`${props.provinceName} açılış durumu`}
      style={{ display: 'flex', gap: spacing.xs, flexWrap: 'wrap', alignItems: 'center' }}
    >
      <input type="hidden" name="provinceId" value={props.provinceId} />
      <label className="field" style={{ minWidth: 170 }}>
        <span className="sr-only">Yeni durum</span>
        <select
          name="launchStatus"
          value={next}
          onChange={(e) => setNext(e.target.value as LaunchStatus)}
        >
          {LAUNCH_STATUSES.map((s) => (
            <option key={s} value={s}>
              {LAUNCH_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="btn"
        disabled={pending || next === props.current}
        onClick={() => dialog.current?.showModal()}
      >
        {pending ? 'Kaydediliyor…' : 'Değiştir'}
      </button>
      <dialog ref={dialog} aria-label="Onay">
        <div style={{ display: 'grid', gap: spacing.md }}>
          <p>
            <strong>{props.provinceName}</strong> için durum{' '}
            <strong>{LAUNCH_STATUS_LABELS[props.current]}</strong> →{' '}
            <strong>{LAUNCH_STATUS_LABELS[next]}</strong> olacak.
          </p>
          <p className="muted">{LAUNCH_STATUS_HINTS[next]}</p>
          <p className="muted">Değişiklik denetim kaydına yazılır.</p>
          <div className="actions">
            <button type="submit" name="confirm" value="yes" className="btn btn-primary">
              Onayla
            </button>
            <button type="button" className="btn" onClick={() => dialog.current?.close()}>
              Vazgeç
            </button>
          </div>
        </div>
      </dialog>
      {state.error ? (
        <p role="alert" style={{ color: colors.emergency, fontSize: 14 }}>
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" style={{ color: colors.success, fontSize: 14 }}>
          Güncellendi.
        </p>
      ) : null}
    </form>
  );
}
