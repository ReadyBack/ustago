import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

const isActive = (s: AppStateStatus | null | undefined) => s !== 'background' && s !== 'inactive';

/**
 * True while this screen is focused and the app is in the foreground.
 * Polling runs only then, so a chat left open in the background costs nothing.
 */
export function useScreenActive(): boolean {
  const [focused, setFocused] = useState(false);
  const [appActive, setAppActive] = useState(() => isActive(AppState.currentState));

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(isActive(s)));
    return () => sub.remove();
  }, []);

  return focused && appActive;
}
