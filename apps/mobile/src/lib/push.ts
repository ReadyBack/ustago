import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { deviceApi } from '../api/services';

/**
 * Push registration. The in-app notification list is the source of truth;
 * push is only a nudge. Permission is asked with context (a card that says
 * why), never at launch. Without an EAS projectId Expo cannot issue a push
 * token, and this module says so instead of pretending.
 */
export type PushSetup =
  | { state: 'unsupported'; reason: string }
  | { state: 'no-project-id' }
  | { state: 'undetermined' }
  | { state: 'denied' }
  | { state: 'registered'; token: string }
  | { state: 'error'; message: string };

export function pushSupported(os: string = Platform.OS): boolean {
  return os === 'ios' || os === 'android';
}

export function expoProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  const id = extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

let configured = false;

/** Foreground presentation and the Android channel; safe to call repeatedly. */
export async function configurePush(): Promise<void> {
  if (configured || !pushSupported()) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: () =>
      Promise.resolve({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'İş ve teklif bildirimleri',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

/**
 * Registers this device when permission is (or becomes) granted.
 * `ask` shows the system prompt; without it an ungranted permission is left alone.
 */
export async function registerForPush(ask: boolean): Promise<PushSetup> {
  if (!pushSupported()) return { state: 'unsupported', reason: 'Web’de anlık bildirim yok.' };
  try {
    await configurePush();
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) {
      if (!ask || !permission.canAskAgain) {
        return permission.canAskAgain ? { state: 'undetermined' } : { state: 'denied' };
      }
      permission = await Notifications.requestPermissionsAsync();
      if (!permission.granted) return { state: 'denied' };
    }
    const projectId = expoProjectId();
    if (!projectId) return { state: 'no-project-id' };
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await deviceApi.register({
      platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
      pushProvider: 'EXPO',
      pushToken: token,
    });
    return { state: 'registered', token };
  } catch (error) {
    return { state: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

/** Calls `open` with the payload data of a tapped push, including the cold-start one. */
export function onPushTapped(open: (data: Record<string, unknown>) => void): () => void {
  if (!pushSupported()) return () => undefined;
  const last = Notifications.getLastNotificationResponse();
  if (last) {
    open(last.notification.request.content.data ?? {});
    Notifications.clearLastNotificationResponse();
  }
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    open(response.notification.request.content.data ?? {});
  });
  return () => sub.remove();
}
