import Constants from 'expo-constants';
import { Platform } from 'react-native';

export const API_PORT = 3000;

export interface ApiUrlInputs {
  /** EXPO_PUBLIC_API_URL, when set. */
  envUrl: string | undefined;
  /** Where Metro serves the bundle from, e.g. "192.168.1.20:8081" (Expo Go on a phone). */
  hostUri: string | undefined;
  platform: string;
  /** window.location.hostname on web. */
  webHostname: string | undefined;
}

/**
 * Picks the API base URL (without /api/v1):
 *  1. EXPO_PUBLIC_API_URL, when set;
 *  2. web: the host the page was opened from;
 *  3. the computer Metro runs on (the LAN IP a phone reached through the QR code);
 *     an Android emulator reaches its host as 10.0.2.2;
 *  4. localhost.
 */
export function resolveApiUrl({ envUrl, hostUri, platform, webHostname }: ApiUrlInputs): string {
  const explicit = envUrl?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  if (platform === 'web') return `http://${webHostname || 'localhost'}:${API_PORT}`;
  const host = hostUri?.split(':')[0];
  if (host && host !== 'localhost' && host !== '127.0.0.1') {
    return `http://${host}:${API_PORT}`;
  }
  if (platform === 'android') return `http://10.0.2.2:${API_PORT}`;
  return `http://localhost:${API_PORT}`;
}

export const API_URL = resolveApiUrl({
  envUrl: process.env.EXPO_PUBLIC_API_URL,
  hostUri: Constants.expoConfig?.hostUri,
  platform: Platform.OS,
  webHostname: typeof window !== 'undefined' ? window.location?.hostname : undefined,
});

export const IS_DEV = __DEV__;
