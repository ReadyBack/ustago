import type { AuthTokens } from '@ustago/types';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const TOKENS_KEY = 'ustago.tokens';
const MODE_KEY = 'ustago.mode';

/**
 * Tokens live in the platform keychain/keystore (expo-secure-store), never
 * in AsyncStorage. The web build has no keychain: there the tokens stay in
 * sessionStorage (cleared with the tab), which is acceptable for the local
 * web preview only; production clients are the native apps.
 */
const storage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      return typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(key);
    }
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

export async function loadTokens(): Promise<AuthTokens | null> {
  const raw = await storage.get(TOKENS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AuthTokens>;
    if (typeof parsed.accessToken !== 'string' || typeof parsed.refreshToken !== 'string') {
      return null;
    }
    return parsed as AuthTokens;
  } catch {
    return null;
  }
}

export const saveTokens = (tokens: AuthTokens) => storage.set(TOKENS_KEY, JSON.stringify(tokens));
export const clearTokens = () => storage.remove(TOKENS_KEY);

export type AppMode = 'customer' | 'provider';
export async function loadMode(): Promise<AppMode | null> {
  const value = await storage.get(MODE_KEY);
  return value === 'customer' || value === 'provider' ? value : null;
}
export const saveMode = (mode: AppMode) => storage.set(MODE_KEY, mode);
