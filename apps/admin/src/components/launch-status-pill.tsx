import { LAUNCH_STATUS_HINTS, LAUNCH_STATUS_LABELS } from '@/lib/labels';

const TONE = { ACTIVE: 'success', WAITLIST: 'warning', DISABLED: 'neutral' } as const;

export function LaunchStatusPill({ status }: { status: 'ACTIVE' | 'WAITLIST' | 'DISABLED' }) {
  return (
    <span className={`pill pill-${TONE[status]}`} title={LAUNCH_STATUS_HINTS[status]}>
      {LAUNCH_STATUS_LABELS[status]}
    </span>
  );
}
