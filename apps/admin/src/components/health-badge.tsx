import type { HealthResponse } from '@ustago/types';
import { colors, radii, spacing } from '@ustago/ui';

const LABELS = {
  ok: { text: 'API çalışıyor', color: colors.success },
  degraded: { text: 'API kısmen çalışıyor', color: colors.warning },
  down: { text: 'API çalışmıyor', color: colors.emergency },
  unreachable: { text: 'API erişilemiyor', color: colors.emergency },
} as const;

export function HealthBadge({ health }: { health: HealthResponse | null }) {
  const state = health?.status ?? 'unreachable';
  const { text, color } = LABELS[state];

  return (
    <div
      role="status"
      data-state={state}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: spacing.sm,
        padding: `${spacing.sm}px ${spacing.md}px`,
        borderRadius: radii.pill,
        background: colors.background,
        border: `1px solid ${colors.border}`,
      }}
    >
      <span
        aria-hidden
        style={{ width: 10, height: 10, borderRadius: radii.pill, background: color }}
      />
      <span>{text}</span>
      {health ? (
        <span style={{ color: colors.textSecondary }}>
          · DB {health.checks.database.status} · Redis {health.checks.redis.status}
        </span>
      ) : null}
    </div>
  );
}
