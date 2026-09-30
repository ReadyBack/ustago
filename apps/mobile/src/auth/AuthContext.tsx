import type { AuthTokens, CurrentUser } from '@ustago/types';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { ApiError, errorMessage } from '../api/client';
import { authApi } from '../api/services';
import { session } from '../api/session';
import { type AppMode, loadMode, loadTokens, saveMode } from './token-store';

type Status = 'loading' | 'signedOut' | 'signedIn' | 'offline';

interface AuthValue {
  status: Status;
  user: CurrentUser | null;
  mode: AppMode;
  /** Set when the last session ended on its own (refresh failed). */
  notice: string | null;
  offlineError: string | null;
  signIn: (tokens: AuthTokens, user: CurrentUser) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<CurrentUser | null>;
  setMode: (mode: AppMode) => Promise<void>;
  retry: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [mode, setModeState] = useState<AppMode>('customer');
  const [notice, setNotice] = useState<string | null>(null);
  const [offlineError, setOfflineError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Restore the session from SecureStore on start.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [tokens, savedMode] = await Promise.all([loadTokens(), loadMode()]);
      if (savedMode) setModeState(savedMode);
      if (!tokens) {
        session.markRestored();
        if (!cancelled) setStatus('signedOut');
        return;
      }
      await session.setTokens(tokens);
      session.markRestored();
      try {
        const me = await authApi.me();
        if (cancelled) return;
        setUser(me);
        setStatus('signedIn');
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 0) {
          setOfflineError(errorMessage(error));
          setStatus('offline');
        } else {
          await session.setTokens(null);
          setStatus('signedOut');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // A failed token refresh anywhere in the app ends the session.
  useEffect(
    () =>
      session.onExpired(() => {
        setUser(null);
        setNotice('Oturumunuz sona erdi. Lütfen tekrar giriş yapın.');
        setStatus('signedOut');
      }),
    [],
  );

  const signIn = useCallback(async (tokens: AuthTokens, me: CurrentUser) => {
    await session.setTokens(tokens);
    setUser(me);
    setNotice(null);
    setStatus('signedIn');
  }, []);

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // The server session may already be gone; local sign-out still happens.
    }
    await session.setTokens(null);
    setUser(null);
    setStatus('signedOut');
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const me = await authApi.me();
      setUser(me);
      return me;
    } catch {
      return null;
    }
  }, []);

  const setMode = useCallback(async (next: AppMode) => {
    setModeState(next);
    await saveMode(next);
  }, []);

  const retry = useCallback(() => {
    setStatus('loading');
    setAttempt((n) => n + 1);
  }, []);

  const value = useMemo(
    () => ({
      status,
      user,
      mode,
      notice,
      offlineError,
      signIn,
      signOut,
      refreshUser,
      setMode,
      retry,
    }),
    [status, user, mode, notice, offlineError, signIn, signOut, refreshUser, setMode, retry],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

export const isProvider = (user: CurrentUser | null) => Boolean(user?.roles.includes('PROVIDER'));
