/**
 * Public runtime config. Only EXPO_PUBLIC_* variables are inlined into the
 * bundle, so nothing secret may ever be placed here.
 */
export const config = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000',
} as const;
