/**
 * Single source of truth for design tokens (PROJECT.md §24). Components are
 * built per platform in later phases; both admin and mobile read these values.
 */
export const colors = {
  primary: '#1E5EFF',
  primaryDark: '#1646C0',
  emergency: '#E5372B',
  success: '#1F9D55',
  warning: '#F5A524',
  background: '#FFFFFF',
  surface: '#F5F7FA',
  border: '#E2E6EC',
  textPrimary: '#111827',
  textSecondary: '#5B6474',
  textInverse: '#FFFFFF',
} as const;

export type ColorToken = keyof typeof colors;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radii = {
  sm: 6,
  md: 12,
  lg: 20,
  pill: 999,
} as const;

/** Minimum touch target is 48 so one-handed use stays comfortable. */
export const typography = {
  fontSizeBody: 16,
  fontSizeTitle: 24,
  fontSizeHeadline: 32,
  minTouchTarget: 48,
} as const;
