import type { AuthTokens } from '@ustago/types';

import { clearTokens, saveTokens } from '../auth/token-store';
import { ApiClient } from './client';
import { API_URL } from './config';

let current: AuthTokens | null = null;
const expiredListeners = new Set<() => void>();

/** In-memory copy of the tokens; persisted to SecureStore on every change. */
export const session = {
  tokens: (): AuthTokens | null => current,
  async setTokens(tokens: AuthTokens | null): Promise<void> {
    current = tokens;
    if (tokens) await saveTokens(tokens);
    else await clearTokens();
  },
  onExpired(listener: () => void): () => void {
    expiredListeners.add(listener);
    return () => expiredListeners.delete(listener);
  },
};

export const api = new ApiClient(API_URL, {
  getTokens: session.tokens,
  setTokens: session.setTokens,
  onSessionExpired: () => expiredListeners.forEach((listener) => listener()),
});
