import { colors as base, radii, spacing, typography } from '@ustago/ui';

/** Shared tokens plus the tints the mobile screens need. */
export const colors = {
  ...base,
  primarySoft: '#E8EFFF',
  emergencySoft: '#FDECEA',
  successSoft: '#E6F6EC',
  warningSoft: '#FEF5E6',
  muted: '#9AA3B2',
  overlay: 'rgba(17, 24, 39, 0.4)',
  /** UstaBulHemen wordmark colors, sampled from the official logo. */
  brandNavy: '#051B33',
  brandOrange: '#FA9205',
  brandSlate: '#5A7080',
} as const;

export { radii, spacing, typography };

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const toneColors: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: colors.surface, fg: colors.textSecondary },
  info: { bg: colors.primarySoft, fg: colors.primaryDark },
  success: { bg: colors.successSoft, fg: colors.success },
  warning: { bg: colors.warningSoft, fg: '#9A6200' },
  danger: { bg: colors.emergencySoft, fg: colors.emergency },
};
